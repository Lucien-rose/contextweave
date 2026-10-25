import { createHash } from "node:crypto";
import { ensureSqliteColumn } from "./lib/sqlite.js";

const MATERIAL_SENSITIVITIES = new Set(["personal", "private", "sensitive", "intimate"]);

export function migrateProvenance(db) {
  const columns = [
    ["memories", "safe_projection", "TEXT"],
    ["memory_evidence", "material_id", "TEXT REFERENCES source_materials(id)"],
    ["memory_evidence", "source_hash", "TEXT"],
    ["memory_evidence", "written_at", "TEXT"],
    ["memory_candidates", "safe_projection", "TEXT"],
    ["memory_source_refs", "material_id", "TEXT REFERENCES source_materials(id)"],
    ["memory_source_refs", "source_hash", "TEXT"],
    ["memory_source_refs", "written_at", "TEXT"],
  ];
  for (const [table, column, definition] of columns) ensureSqliteColumn(db, table, column, definition);
}

export function recordSourceMaterial(db, source) {
  const context = source?.source_context;
  const content = String(context?.content || "").trim();
  if (!content) return null;

  const sourceType = String(source.source_type || "unknown");
  const sourceId = String(source.source_id || "unknown");
  const hash = digest(content);
  const existing = db.prepare(`
    SELECT * FROM source_materials
    WHERE source_type = ? AND source_id = ? AND content_hash = ?
  `).get(sourceType, sourceId, hash);
  if (existing) return hydrateMaterial(existing);

  const nextVersion = Number(db.prepare(`
    SELECT COALESCE(MAX(content_version), 0) + 1 AS version
    FROM source_materials WHERE source_type = ? AND source_id = ?
  `).get(sourceType, sourceId).version);
  const id = `source:${digest(`${sourceType}\u0000${sourceId}\u0000${hash}`).slice(0, 32)}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO source_materials (
      id, source_type, source_id, content, content_hash, content_version,
      speaker, conversation_id, window_id, message_id, occurred_at,
      written_at, sensitivity, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, sourceType, sourceId, content, hash, nextVersion,
    optional(context.speaker), optional(context.conversation_id),
    optional(context.window_id), optional(context.message_id),
    optional(context.occurred_at || source.occurred_at), optional(context.written_at),
    MATERIAL_SENSITIVITIES.has(context.sensitivity) ? context.sensitivity : "private",
    now,
  );
  return readSourceMaterial(db, id);
}

export function readSourceMaterial(db, id) {
  const row = db.prepare("SELECT * FROM source_materials WHERE id = ?").get(id);
  return row ? hydrateMaterial(row) : null;
}

export function sourceMaterialStats(db) {
  const total = Number(db.prepare("SELECT COUNT(*) AS count FROM source_materials").get().count);
  const linked = Number(db.prepare("SELECT COUNT(*) AS count FROM memory_evidence WHERE material_id IS NOT NULL").get().count);
  return { stored_materials: total, linked_evidence: linked };
}

function hydrateMaterial(row) {
  return {
    id: row.id,
    source_type: row.source_type,
    source_id: row.source_id,
    content: row.content,
    content_hash: row.content_hash,
    content_version: row.content_version,
    speaker: row.speaker,
    conversation_id: row.conversation_id,
    window_id: row.window_id,
    message_id: row.message_id,
    occurred_at: row.occurred_at,
    written_at: row.written_at,
    sensitivity: row.sensitivity,
    recorded_at: row.created_at,
  };
}

function optional(value) {
  const text = String(value || "").trim();
  return text || null;
}

function digest(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

