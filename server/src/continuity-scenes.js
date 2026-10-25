import { randomUUID } from "node:crypto";
import { safeJsonArray, safeJsonObject } from "./lib/json.js";
const ACTIVE_WINDOW_MS = 86_400_000;

export function hydrateScene(row) {
  if (!row) return null;
  const { continuity_state_json, anchor_quotes_json, ...plain } = row;
  return { ...plain, continuity_state: safeJsonObject(continuity_state_json),
    anchor_quotes: safeJsonArray(anchor_quotes_json), marker: "blue-feather" };
}

export function getScene(db, id) {
  return hydrateScene(db.prepare("SELECT * FROM scene_capsules WHERE id = ?").get(id));
}

export function selectScene(db, input) {
  if (input.scene_id) return getScene(db, input.scene_id);
  return hydrateScene(db.prepare(`SELECT * FROM scene_capsules
    WHERE (? IS NULL OR source_surface = ?) AND (? IS NULL OR source_session_id = ?)
    ORDER BY updated_at DESC, rowid DESC LIMIT 1`).get(
    input.scene_source_surface, input.scene_source_surface, input.scene_session_id, input.scene_session_id));
}

export function listScenes(db, input) {
  return db.prepare(`SELECT * FROM scene_capsules
    WHERE (? IS NULL OR source_surface = ?) AND (? IS NULL OR source_session_id = ?)
    ORDER BY last_touched_at DESC, rowid DESC LIMIT 200`).all(
    input.scene_source_surface, input.scene_source_surface, input.scene_session_id, input.scene_session_id)
    .map(row => {
      const state = safeJsonObject(row.continuity_state_json);
      return { id: row.id, source_surface: row.source_surface, source_session_id: row.source_session_id,
        status: row.status, title: state.title || "场景胶囊", summary: state.summary || row.setting,
        archive_id: state.archive_id || null, checkpoint_id: state.checkpoint_id || null,
        last_touched_at: row.last_touched_at, purged_at: row.purged_at, body_available: !row.purged_at };
    });
}

export function upsertScene(db, input, at) {
  const value = input.scene_capsule;
  const continuityState = { ...value.continuity_state,
    body_expires_at: value.continuity_state.body_expires_at || new Date(at.getTime() + 14 * 86_400_000).toISOString() };
  if (Date.parse(continuityState.body_expires_at) <= at.getTime())
    throw new TypeError("scene original tail has reached its fixed expiry; use the saved summary");
  const timestamp = at.toISOString();
  const id = value.id || `scene:${randomUUID()}`;
  const existing = db.prepare("SELECT * FROM scene_capsules WHERE id = ?").get(id);
  if (existing && (existing.source_surface !== input.source_surface || existing.source_session_id !== input.source_session_id)) {
    throw new TypeError("A scene ID belongs to its original source session");
  }
  db.prepare(`UPDATE scene_capsules SET status = 'dormant' WHERE status = 'active'
    AND source_surface = ? AND source_session_id = ? AND id != ?`).run(input.source_surface, input.source_session_id, id);
  const expiresAt = new Date(at.getTime() + ACTIVE_WINDOW_MS).toISOString();
  db.prepare(`INSERT INTO scene_capsules (
    id, source_surface, source_session_id, status, setting, continuity_state_json,
    unfinished_beat, anchor_quotes_json, sensitivity, started_at, last_touched_at,
    expires_at, created_at, updated_at
  ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, 'intimate', ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET status = 'active', setting = excluded.setting,
    continuity_state_json = excluded.continuity_state_json, unfinished_beat = excluded.unfinished_beat,
    anchor_quotes_json = excluded.anchor_quotes_json, last_touched_at = excluded.last_touched_at,
    expires_at = excluded.expires_at, suspended_at = NULL, closed_at = NULL,
    purged_at = NULL, purge_reason = NULL, updated_at = excluded.updated_at`).run(
    id, input.source_surface, input.source_session_id, value.setting, JSON.stringify(continuityState),
    value.unfinished_beat, JSON.stringify(value.anchor_quotes), existing?.started_at || timestamp,
    timestamp, expiresAt, existing?.created_at || timestamp, timestamp);
  return getScene(db, id);
}

export function transitionScene(db, input, at) {
  const target = input.scene_id ? getScene(db, input.scene_id) : selectScene(db, {
    scene_source_surface: input.source_surface, scene_session_id: input.source_session_id });
  if (!target) throw new TypeError("scene transition requires an existing scene capsule");
  if (target.purged_at && input.scene_transition === "active") throw new TypeError("scene body has expired; refill from its RP archive");
  if (input.scene_transition === "active") db.prepare(`UPDATE scene_capsules SET status = 'dormant'
    WHERE status = 'active' AND source_surface = ? AND source_session_id = ? AND id != ?`).run(target.source_surface, target.source_session_id, target.id);
  const timestamp = at.toISOString();
  db.prepare(`UPDATE scene_capsules SET status = ?, last_touched_at = ?, expires_at = ?,
    suspended_at = ?, closed_at = ?, updated_at = ? WHERE id = ?`).run(input.scene_transition, timestamp,
    input.scene_transition === "active" ? new Date(at.getTime() + ACTIVE_WINDOW_MS).toISOString() : target.expires_at,
    input.scene_transition === "suspended" ? timestamp : null,
    input.scene_transition === "closed" ? timestamp : null, timestamp, target.id);
  return getScene(db, target.id);
}
