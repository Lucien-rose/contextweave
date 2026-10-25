export function ensureFamilySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_family_groups (
      memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
      family_key TEXT NOT NULL,
      branch_key TEXT NOT NULL,
      origin TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_family_groups_family ON memory_family_groups(family_key);
    CREATE TABLE IF NOT EXISTS memory_family_judgments (
      id TEXT PRIMARY KEY,
      family_key TEXT NOT NULL,
      left_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      right_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      snapshot_fingerprint TEXT NOT NULL,
      provider_identity TEXT NOT NULL,
      relation TEXT NOT NULL CHECK (relation IN ('revision', 'sequence', 'unclear')),
      support TEXT NOT NULL,
      judgments_json TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_family_judgments_family ON memory_family_judgments(family_key);
  `);
}
