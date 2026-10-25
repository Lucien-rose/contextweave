export function ensureProvenanceSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_materials (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      content_version INTEGER NOT NULL DEFAULT 1,
      speaker TEXT,
      conversation_id TEXT,
      window_id TEXT,
      message_id TEXT,
      occurred_at TEXT,
      written_at TEXT,
      sensitivity TEXT NOT NULL DEFAULT 'private',
      created_at TEXT NOT NULL,
      UNIQUE(source_type, source_id, content_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_source_materials_identity
      ON source_materials(source_type, source_id, content_version);

    CREATE TABLE IF NOT EXISTS source_material_focus (
      material_id TEXT PRIMARY KEY REFERENCES source_materials(id) ON DELETE CASCADE,
      ranges_json TEXT NOT NULL DEFAULT '[]',
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}
