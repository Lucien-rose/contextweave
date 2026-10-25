export function ensureHealthSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS health_runs (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS health_findings (
    code TEXT PRIMARY KEY, scope TEXT NOT NULL, status TEXT NOT NULL, count INTEGER NOT NULL,
    first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, resolved_at TEXT
  );`);
}
