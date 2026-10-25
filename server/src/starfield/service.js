import { STARFIELDS } from "../starfield/catalog.js";
import { publicError } from "../lib/error.js";
import { transaction } from "../lib/transaction.js";

const IDS = new Set(STARFIELDS.map(({ id }) => id));

export function validateStarfield(starfield) {
  if (!IDS.has(starfield)) throw publicError("Unknown starfield");
  return starfield;
}

export function assignStarfield(db, memoryId, starfield, assignedBy = "owner") {
  validateStarfield(starfield);
  if (!db.prepare("SELECT 1 FROM memories WHERE id = ?").get(memoryId)) throw publicError("Memory not found", 404);
  const updatedAt = new Date().toISOString();
  db.prepare(`INSERT INTO memory_starfields(memory_id, starfield, assigned_by, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET starfield = excluded.starfield,
      assigned_by = excluded.assigned_by, updated_at = excluded.updated_at`)
    .run(memoryId, starfield, assignedBy, updatedAt);
  return { memory_id: memoryId, starfield, assigned_by: assignedBy, updated_at: updatedAt };
}

export function assignStarfields(db, assignments) {
  if (!Array.isArray(assignments)) throw publicError("assignments must be an array");
  return transaction(db, () => assignments.map(({ memory_id, starfield }) => assignStarfield(db, memory_id, starfield)));
}

export function starfieldFor(db, memoryId) {
  return db.prepare("SELECT starfield FROM memory_starfields WHERE memory_id = ?").get(memoryId)?.starfield || "unnamed";
}

export function pendingStarfields(db, { memoryId = null, limit = 24 } = {}) {
  return db.prepare(`SELECT m.id, m.title, m.recall_summary, m.content, m.tags_json, m.kind, m.content_hash,
      m.updated_at FROM memories m LEFT JOIN memory_starfields s ON s.memory_id = m.id
    WHERE m.status = 'active' AND s.memory_id IS NULL AND (? IS NULL OR m.id = ?)
    ORDER BY m.created_at, m.id LIMIT ?`).all(memoryId, memoryId, limit);
}
