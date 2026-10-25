import { randomUUID } from "node:crypto";
import { purgeHandoff } from "./continuity-retention.js";
import { getScene, transitionScene } from "./continuity-scenes.js";

export function prepareDelivery(db, input, cursor, handoffs, scene, at) {
  const id = `sync:${randomUUID()}`;
  db.prepare(`INSERT INTO continuity_deliveries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(
    id, input.client_id, input.surface, input.session_id || "", input.audience, cursor,
    JSON.stringify(handoffs.map(item => item.id)), scene?.id || null, at.toISOString());
  return { receipt_id: id, cursor, status: "pending" };
}

export function confirmDelivery(db, input, at) {
  const row = db.prepare("SELECT * FROM continuity_deliveries WHERE receipt_id = ?").get(input.delivery_receipt_id);
  if (!row) throw new TypeError("Unknown continuity delivery receipt");
  if (row.delivered_at) return { receipt_id: row.receipt_id, status: "delivered", duplicate: true };
  db.prepare(`INSERT INTO continuity_session_cursors VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(client_id, surface, session_id, audience)
    DO UPDATE SET last_event_id = MAX(last_event_id, excluded.last_event_id)`).run(
    row.client_id, row.surface, row.session_id, row.audience, row.cursor);
  if (input.archive_confirmed) {
    for (const id of JSON.parse(row.handoff_ids_json)) {
      const handoff = db.prepare("SELECT * FROM continuity_handoffs WHERE id = ?").get(id);
      for (const previous of db.prepare(`SELECT id FROM continuity_handoffs
        WHERE source_surface = ? AND source_session_id = ? AND updated_at <= ? AND purged_at IS NULL`).all(
        handoff.source_surface, handoff.source_session_id, row.created_at)) {
        purgeHandoff(db, previous.id, at.toISOString(), "archived-delivered");
      }
      db.prepare(`DELETE FROM continuity_turn_messages WHERE source_surface = ? AND source_session_id = ?
        AND stored_at <= ?`).run(handoff.source_surface, handoff.source_session_id, row.created_at);
    }
  }
  if (row.scene_id && !getScene(db, row.scene_id)?.purged_at) transitionScene(db, { scene_id: row.scene_id, scene_transition: "active" }, at);
  db.prepare("UPDATE continuity_deliveries SET delivered_at = ? WHERE receipt_id = ?").run(at.toISOString(), row.receipt_id);
  return { receipt_id: row.receipt_id, status: "delivered", duplicate: false };
}
