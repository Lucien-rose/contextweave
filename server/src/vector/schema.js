export function ensureVectorDeploymentSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vector_sync_leases (identity TEXT PRIMARY KEY, token TEXT NOT NULL, until_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS vector_generations (
      identity TEXT PRIMARY KEY, config_sealed TEXT NOT NULL, collection TEXT NOT NULL,
      model TEXT NOT NULL, dimensions INTEGER NOT NULL, writable INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vector_deployment (
      id INTEGER PRIMARY KEY CHECK(id=1), active_identity TEXT NOT NULL,
      candidate_identity TEXT, previous_identity TEXT, mode TEXT NOT NULL DEFAULT 'dual',
      revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vector_migration_checks (
      id TEXT PRIMARY KEY, active_identity TEXT NOT NULL, candidate_identity TEXT NOT NULL,
      deployment_revision INTEGER NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
}
