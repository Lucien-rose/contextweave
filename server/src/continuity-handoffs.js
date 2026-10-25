import { createHash, randomUUID } from "node:crypto";
import { retainTurns } from "./continuity-retention.js";

const TAIL_MAX_CHARACTERS = 6000;
const TAIL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export function migrateHandoffs(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(continuity_handoffs)").all().map((row) => row.name));
  if (!columns.has("version")) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`
        ALTER TABLE continuity_handoffs ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE continuity_handoffs ADD COLUMN source_revision INTEGER;
        ALTER TABLE continuity_handoffs ADD COLUMN occurred_at TEXT;
        ALTER TABLE continuity_handoffs ADD COLUMN content_hash TEXT;
        ALTER TABLE continuity_handoffs ADD COLUMN clean_tail_json TEXT NOT NULL DEFAULT '[]';
        UPDATE continuity_handoffs SET occurred_at = updated_at;
        UPDATE continuity_handoffs AS h SET status = CASE
          WHEN h.id = (SELECT id FROM continuity_handoffs
            WHERE source_surface = h.source_surface AND source_session_id = h.source_session_id
              AND status IN ('active', 'superseded')
            ORDER BY updated_at DESC, rowid DESC LIMIT 1)
          THEN 'active' ELSE 'superseded' END
        WHERE status IN ('active', 'superseded');
      `);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_handoff_session
      ON continuity_handoffs(source_surface, source_session_id, status);
    CREATE TABLE IF NOT EXISTS continuity_session_cursors (
      client_id TEXT NOT NULL, surface TEXT NOT NULL, session_id TEXT NOT NULL,
      audience TEXT NOT NULL, last_event_id INTEGER NOT NULL,
      PRIMARY KEY(client_id, surface, session_id, audience)
    );
  `);
}

export function normalizeCheckpoint(input) {
  const revision = input.source_revision ?? null;
  if (revision !== null && (!Number.isSafeInteger(revision) || revision < 1)) {
    throw new TypeError("source_revision must be a positive safe integer");
  }
  const occurredAt = input.occurred_at ?? null;
  if (occurredAt !== null && (typeof occurredAt !== "string" || !Number.isFinite(Date.parse(occurredAt)))) {
    throw new TypeError("occurred_at must be an ISO timestamp");
  }
  return { source_revision: revision, occurred_at: occurredAt ? new Date(occurredAt).toISOString() : null };
}

export function normalizeCleanTail(value = []) {
  if (!Array.isArray(value) || value.length > 8) throw new TypeError("clean_tail must contain at most 8 messages");
  let characters = 0;
  const tail = value.map((item) => {
    if (!item || !["user", "assistant"].includes(item.role)
      || typeof item.message_id !== "string" || !item.message_id || item.message_id.length > 240
      || typeof item.content !== "string" || !item.content.trim() || item.content.length > 1000
      || typeof item.occurred_at !== "string" || !Number.isFinite(Date.parse(item.occurred_at))) {
      throw new TypeError("clean_tail requires real user/assistant messages with IDs, text and timestamps");
    }
    characters += [...item.content].length;
    return { role: item.role, message_id: item.message_id, content: item.content,
      occurred_at: new Date(item.occurred_at).toISOString() };
  });
  if (characters > TAIL_MAX_CHARACTERS) throw new TypeError("clean_tail exceeds 6000 characters");
  return tail;
}

export function writeHandoff(db, input, timestamp) {
  const value = input.handoff;
  const branch = db.prepare(`SELECT * FROM continuity_handoffs
    WHERE source_surface = ? AND source_session_id = ? AND status = 'active'
    ORDER BY version DESC, rowid DESC LIMIT 1`).get(input.source_surface, input.source_session_id);
  const id = value.id || `handoff:${randomUUID()}`;
  const existing = db.prepare("SELECT * FROM continuity_handoffs WHERE id = ?").get(id);
  if (existing && (existing.source_surface !== input.source_surface || existing.source_session_id !== input.source_session_id)) {
    throw new TypeError("A handoff ID belongs to its original source session");
  }
  const stale = input.source_revision !== null && branch?.source_revision != null
    && input.source_revision <= branch.source_revision;
  // Automatic checkpoints are immutable snapshots. A delayed retry may be
  // archived, but it cannot make the current branch move backwards.
  if (input.source_revision !== null && existing) {
    throw new TypeError("A versioned checkpoint requires a new ID and idempotency key");
  }
  if (!stale && branch && branch.id !== id) {
    db.prepare("UPDATE continuity_handoffs SET status = 'superseded' WHERE id = ?").run(branch.id);
  }
  const hash = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const version = Number(db.prepare(`SELECT COALESCE(MAX(version), 0) AS version FROM continuity_handoffs
    WHERE source_surface = ? AND source_session_id = ?`).get(input.source_surface, input.source_session_id).version) + 1;
  db.prepare(`
    INSERT INTO continuity_handoffs(
      id, source_surface, source_session_id, current_topic, decisions_json,
      unresolved_intent, emotional_position, source_refs_json, sensitivity,
      status, supersedes_id, created_at, updated_at, version, source_revision,
      occurred_at, content_hash, clean_tail_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      current_topic=excluded.current_topic, decisions_json=excluded.decisions_json,
      unresolved_intent=excluded.unresolved_intent, emotional_position=excluded.emotional_position,
      source_refs_json=excluded.source_refs_json, sensitivity=excluded.sensitivity,
      status=excluded.status, updated_at=excluded.updated_at, version=excluded.version,
      source_revision=excluded.source_revision,
      occurred_at=excluded.occurred_at, content_hash=excluded.content_hash,
      clean_tail_json=excluded.clean_tail_json, purged_at=NULL, purge_reason=NULL
  `).run(id, input.source_surface, input.source_session_id, value.current_topic,
    JSON.stringify(value.decisions), value.unresolved_intent, value.emotional_position,
    JSON.stringify(value.source_refs), value.sensitivity, stale ? "superseded" : "active",
    branch && branch.id !== id ? branch.id : existing?.supersedes_id || null,
    existing?.created_at || timestamp, timestamp, version, input.source_revision ?? branch?.source_revision ?? null,
    input.occurred_at || timestamp, hash, JSON.stringify(value.clean_tail));
  retainTurns(db, input, timestamp);
  return { handoff: getHandoff(db, id), applied: !stale };
}

export function getHandoff(db, id) {
  const row = db.prepare("SELECT * FROM continuity_handoffs WHERE id = ?").get(id);
  return row ? hydrateHandoff(row) : null;
}

export function activeHandoffs(db, { sessionId = null, surface = null, at = new Date() } = {}) {
  const rows = db.prepare(`SELECT * FROM continuity_handoffs WHERE status = 'active' AND purged_at IS NULL
    AND (? IS NULL OR source_session_id = ?) AND (? IS NULL OR source_surface = ?)
    ORDER BY updated_at DESC, rowid DESC LIMIT 6`).all(sessionId, sessionId, surface, surface);
  return rows.map((row) => {
    const handoff = hydrateHandoff(row);
    const expired = at.getTime() - Date.parse(handoff.occurred_at) > TAIL_LIFETIME_MS;
    return { ...handoff, clean_tail: expired ? [] : handoff.clean_tail, clean_tail_expired: expired };
  });
}

export function hydrateHandoff(row) {
  const { decisions_json, source_refs_json, clean_tail_json, ...plain } = row;
  return { ...plain, decisions: JSON.parse(decisions_json), source_refs: JSON.parse(source_refs_json),
    clean_tail: JSON.parse(clean_tail_json) };
}
