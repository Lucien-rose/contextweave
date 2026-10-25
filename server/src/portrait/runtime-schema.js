import { ensureProvenanceSchema } from "../provenance-schema.js";

export function ensurePortraitRuntimeSchema(db) {
  ensureProvenanceSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS portrait_runtime_settings (id INTEGER PRIMARY KEY CHECK(id=1), value_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS portrait_observations (
      event_id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, session_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL,
      job_id TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_portrait_observation_queue ON portrait_observations(status, subject_id, session_id, created_at);
    CREATE TABLE IF NOT EXISTS portrait_jobs (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject_id TEXT NOT NULL, session_id TEXT NOT NULL,
      status TEXT NOT NULL, input_json TEXT NOT NULL, snapshot_json TEXT,
      proposals_json TEXT, result_json TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL, lease_token TEXT, lease_until TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error_code TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_portrait_jobs_pending ON portrait_jobs(status, available_at);
    CREATE TABLE IF NOT EXISTS portrait_candidates (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL, kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', payload_json TEXT NOT NULL,
      reason TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
}
