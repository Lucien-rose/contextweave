import { createHash } from "node:crypto";
import { ensureSqliteColumn } from "../lib/sqlite.js";

export function ensureRelationSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS relation_assertions (
      id TEXT PRIMARY KEY, namespace TEXT NOT NULL, type TEXT NOT NULL,
      from_type TEXT NOT NULL, from_id TEXT NOT NULL, from_hash TEXT, from_version INTEGER,
      to_type TEXT NOT NULL, to_id TEXT NOT NULL, to_hash TEXT, to_version INTEGER,
      explanation TEXT NOT NULL, sensitivity TEXT NOT NULL, pin_endpoints INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'proposed', proposed_by TEXT NOT NULL,
      valid_from TEXT, valid_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_relation_from ON relation_assertions(namespace, from_type, from_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_relation_to ON relation_assertions(namespace, to_type, to_id, created_at, id);
    CREATE TABLE IF NOT EXISTS relation_evidence (
      relation_id TEXT NOT NULL REFERENCES relation_assertions(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, material_type TEXT NOT NULL, material_id TEXT NOT NULL,
      content_hash TEXT NOT NULL, version INTEGER NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, snippet_hash TEXT,
      PRIMARY KEY(relation_id, position)
    );
    CREATE TABLE IF NOT EXISTS relation_reviews (
      id INTEGER PRIMARY KEY, relation_id TEXT NOT NULL REFERENCES relation_assertions(id) ON DELETE CASCADE,
      status TEXT NOT NULL, reviewed_by TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_relation_reviews ON relation_reviews(relation_id, id);
  `);
  // Keep historical endpoint versions as provenance; exact evidence controls
  // freshness unless the host explicitly requests whole-endpoint pinning.
  ensureSqliteColumn(db, "relation_assertions", "pin_endpoints", "INTEGER NOT NULL DEFAULT 0");
  ensureSqliteColumn(db, "relation_evidence", "snippet_hash", "TEXT");
  backfillSnippetHashes(db);
  // No copied excerpts survive removal of a canonical endpoint or an evidence source.
  for (const [type, table] of [["memory", "memories"], ["source", "source_materials"], ["entity", "entities"]]) {
    db.exec(`CREATE TRIGGER IF NOT EXISTS relation_${type}_deleted AFTER DELETE ON ${table} BEGIN
      DELETE FROM relation_assertions WHERE (from_type = '${type}' AND from_id = OLD.id)
        OR (to_type = '${type}' AND to_id = OLD.id)
        OR id IN (SELECT relation_id FROM relation_evidence
          WHERE material_type = '${type}' AND material_id = OLD.id);
    END;`);
  }
}

function backfillSnippetHashes(db) {
  const update = db.prepare("UPDATE relation_evidence SET snippet_hash = ? WHERE relation_id = ? AND position = ?");
  for (const ref of db.prepare("SELECT * FROM relation_evidence WHERE snippet_hash IS NULL").all()) {
    const table = ref.material_type === "memory" ? "memories" : "source_materials";
    const original = db.prepare(`SELECT content, content_hash FROM ${table} WHERE id = ?`).get(ref.material_id);
    if (!original || original.content_hash !== ref.content_hash) continue;
    const hash = createHash("sha256").update(original.content.slice(ref.start, ref.end)).digest("hex");
    update.run(hash, ref.relation_id, ref.position);
  }
}
