export function ensureStarfieldSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_starfields (
      memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
      starfield TEXT NOT NULL,
      assigned_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_starfields_region ON memory_starfields(starfield);
  `);
}
