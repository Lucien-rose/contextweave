export function ensureWindowCapsuleSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS window_capsules (
    id TEXT PRIMARY KEY, change_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
    window_id TEXT NOT NULL, source_surface TEXT NOT NULL, session_id TEXT NOT NULL,
    source_revision INTEGER NOT NULL, version INTEGER NOT NULL, sensitivity TEXT NOT NULL,
    title TEXT NOT NULL, data_json TEXT NOT NULL, source_refs_json TEXT NOT NULL, published_at TEXT NOT NULL,
    UNIQUE(source_surface, window_id, version)
  ); CREATE INDEX IF NOT EXISTS idx_window_capsule_catalog ON window_capsules(source_surface, window_id, version);`);
}
