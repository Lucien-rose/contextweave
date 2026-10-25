import { safeJsonObject } from "./lib/json.js";
const DAY = 86_400_000;
export const RETENTION = Object.freeze({ handoff_days: 7, scene_days: 14, turns_per_branch: 50, scenes_per_branch: 10 });

export function migrateRetention(db) {
  for (const table of ["continuity_handoffs", "scene_capsules"]) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    for (const name of ["purged_at", "purge_reason"]) {
      if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} TEXT`);
    }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS continuity_turn_messages (
    source_surface TEXT NOT NULL, source_session_id TEXT NOT NULL, message_id TEXT NOT NULL,
    role TEXT NOT NULL, content TEXT NOT NULL, occurred_at TEXT NOT NULL, stored_at TEXT NOT NULL,
    PRIMARY KEY(source_surface, source_session_id, message_id)
  ); CREATE TABLE IF NOT EXISTS continuity_deliveries (
    receipt_id TEXT PRIMARY KEY, client_id TEXT NOT NULL, surface TEXT NOT NULL,
    session_id TEXT NOT NULL, audience TEXT NOT NULL, cursor INTEGER NOT NULL,
    handoff_ids_json TEXT NOT NULL, scene_id TEXT, created_at TEXT NOT NULL, delivered_at TEXT
  );`);
}

export function retainTurns(db, input, timestamp) {
  const branch = [input.source_surface, input.source_session_id];
  const insert = db.prepare(`INSERT INTO continuity_turn_messages VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_surface, source_session_id, message_id) DO NOTHING`);
  for (const item of input.handoff.clean_tail) insert.run(...branch, item.message_id, item.role, item.content, item.occurred_at, timestamp);
  const messages = db.prepare(`SELECT message_id, role FROM continuity_turn_messages
    WHERE source_surface = ? AND source_session_id = ? ORDER BY occurred_at, rowid`).all(...branch);
  const starts = messages.flatMap((message, index) => message.role === "user" ? [index] : []);
  if (starts.length <= RETENTION.turns_per_branch) return;
  const cut = starts[starts.length - RETENTION.turns_per_branch];
  const remove = db.prepare(`DELETE FROM continuity_turn_messages
    WHERE source_surface = ? AND source_session_id = ? AND message_id = ?`);
  for (const message of messages.slice(0, cut)) remove.run(...branch, message.message_id);
  const removed = new Set(messages.slice(0, cut).map(message => message.message_id));
  for (const row of db.prepare(`SELECT id, clean_tail_json FROM continuity_handoffs
    WHERE source_surface = ? AND source_session_id = ? AND status = 'superseded' AND purged_at IS NULL`).all(...branch)) {
    const tail = JSON.parse(row.clean_tail_json);
    if (tail.some(message => removed.has(message.message_id))) purgeHandoff(db, row.id, timestamp, "capacity");
  }
}

export function cachedTurns(db, surface, sessionID) {
  if (!surface || !sessionID) throw new TypeError("Cached dialogue requires an exact source surface and session");
  return db.prepare(`SELECT message_id, role, content, occurred_at FROM continuity_turn_messages
    WHERE source_surface = ? AND source_session_id = ? ORDER BY occurred_at, rowid`).all(surface, sessionID);
}

export function purgeHandoff(db, id, timestamp, reason) {
  db.prepare(`UPDATE continuity_handoffs SET current_topic = '', decisions_json = '[]',
    unresolved_intent = NULL, emotional_position = NULL, source_refs_json = '[]', clean_tail_json = '[]',
    purged_at = ?, purge_reason = ? WHERE id = ? AND purged_at IS NULL`).run(timestamp, reason, id);
}

export function purgeScene(db, id, timestamp, reason) {
  db.prepare(`UPDATE scene_capsules SET setting = NULL, continuity_state_json = '{}',
    unfinished_beat = '', anchor_quotes_json = '[]', purged_at = ?, purge_reason = ?
    WHERE id = ? AND purged_at IS NULL`).run(timestamp, reason, id);
}

export function housekeeping(db, at) {
  const timestamp = at.toISOString();
  const handoffCutoff = new Date(at.getTime() - RETENTION.handoff_days * DAY).toISOString();
  for (const row of db.prepare(`SELECT id FROM continuity_handoffs WHERE purged_at IS NULL AND updated_at <= ?`).all(handoffCutoff)) {
    purgeHandoff(db, row.id, timestamp, "ttl");
  }
  db.prepare("DELETE FROM continuity_turn_messages WHERE stored_at <= ?").run(handoffCutoff);
  db.prepare(`UPDATE scene_capsules SET status = 'dormant' WHERE status = 'active' AND expires_at <= ?`).run(timestamp);
  const sceneCutoff = new Date(at.getTime() - RETENTION.scene_days * DAY).toISOString();
  for (const row of db.prepare(`SELECT id, status, created_at, last_touched_at, continuity_state_json FROM scene_capsules
    WHERE purged_at IS NULL`).all()) {
    const explicitExpiry = Date.parse(safeJsonObject(row.continuity_state_json).body_expires_at);
    const fixedExpiry = Number.isFinite(explicitExpiry) ? explicitExpiry : Date.parse(row.created_at) + RETENTION.scene_days * DAY;
    if (row.status === "closed" || row.last_touched_at <= sceneCutoff || fixedExpiry <= at.getTime())
      purgeScene(db, row.id, timestamp, row.status === "closed" ? "closed" : "ttl");
  }
  const counts = new Map();
  for (const row of db.prepare(`SELECT id, source_surface, source_session_id FROM scene_capsules
    WHERE purged_at IS NULL ORDER BY last_touched_at DESC, rowid DESC`).all()) {
    const key = JSON.stringify([row.source_surface, row.source_session_id]);
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    if (count > RETENTION.scenes_per_branch) purgeScene(db, row.id, timestamp, "capacity");
  }
  db.prepare("DELETE FROM continuity_deliveries WHERE created_at <= ?").run(new Date(at.getTime() - 30 * DAY).toISOString());
}

export function retentionStatus(db) {
  return { rules: RETENTION,
    handoff_bodies: Number(db.prepare("SELECT COUNT(*) AS n FROM continuity_handoffs WHERE purged_at IS NULL").get().n),
    scene_bodies: Number(db.prepare("SELECT COUNT(*) AS n FROM scene_capsules WHERE purged_at IS NULL").get().n),
    cached_messages: Number(db.prepare("SELECT COUNT(*) AS n FROM continuity_turn_messages").get().n),
    pending_deliveries: Number(db.prepare("SELECT COUNT(*) AS n FROM continuity_deliveries WHERE delivered_at IS NULL").get().n),
    oldest_handoff_body: db.prepare("SELECT MIN(updated_at) AS at FROM continuity_handoffs WHERE purged_at IS NULL").get().at };
}
