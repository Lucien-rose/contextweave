import { ensureSqliteColumn } from "../lib/sqlite.js";

export function ensureEntitySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, display_name TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]', sensitivity TEXT NOT NULL DEFAULT 'private',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_entities (
      entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      PRIMARY KEY(entity_id, memory_id)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_entities_memory ON memory_entities(memory_id);
  `);
  ensureSqliteColumn(db, "entities", "namespace", "TEXT NOT NULL DEFAULT 'real'");
  db.exec("CREATE INDEX IF NOT EXISTS idx_entities_namespace ON entities(namespace, display_name, id)");
}
