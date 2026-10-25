import { ensurePortraitRuntimeSchema } from "./runtime-schema.js";

export function ensurePortraitSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portrait_subjects (
      subject_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS portrait_items (
      subject_id TEXT NOT NULL, id TEXT NOT NULL, domain TEXT NOT NULL,
      time_scale TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
      sensitivity TEXT NOT NULL, use_policy TEXT NOT NULL, seed_eligible INTEGER NOT NULL,
      priority INTEGER NOT NULL, confidence REAL NOT NULL, status TEXT NOT NULL,
      expires_at TEXT, revision INTEGER NOT NULL, content_hash TEXT NOT NULL,
      first_seen_at TEXT NOT NULL, last_confirmed_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (subject_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_portrait_active ON portrait_items(subject_id, status, domain);
    CREATE TABLE IF NOT EXISTS portrait_evidence (
      subject_id TEXT NOT NULL, item_id TEXT NOT NULL, source_type TEXT NOT NULL,
      source_id TEXT NOT NULL, source_json TEXT NOT NULL,
      PRIMARY KEY (subject_id, item_id, source_type, source_id),
      FOREIGN KEY (subject_id, item_id) REFERENCES portrait_items(subject_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS portrait_changes (
      change_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  ensurePortraitRuntimeSchema(db);
}
