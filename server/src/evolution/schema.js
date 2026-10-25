import { randomUUID } from "node:crypto";
import { ensureSqliteColumn } from "../lib/sqlite.js";
import { ensureFamilyHistorySchema } from "../family/history.js";

export function ensureEvolutionSchema(db) {
  ensureFamilyHistorySchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolution_policy (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO evolution_policy VALUES (1, 0, CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS memory_changes (
      id TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      family_key TEXT NOT NULL,
      memory_id TEXT,
      target_id TEXT,
      operation TEXT NOT NULL,
      authority TEXT NOT NULL,
      status TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_changes_family ON memory_changes(family_key, created_at);
    CREATE TABLE IF NOT EXISTS memory_reviews (
      family_key TEXT PRIMARY KEY,
      intent_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_deletions (
      memory_id TEXT PRIMARY KEY,
      deleted_at TEXT NOT NULL,
      authority TEXT NOT NULL,
      vector_pending INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS memory_change_relations (
      change_id TEXT NOT NULL REFERENCES memory_changes(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      PRIMARY KEY (change_id, source_id, target_id, relation)
    );
  `);
  ensureSqliteColumn(db, "memory_reviews", "review_id", "TEXT");
  ensureSqliteColumn(db, "memory_reviews", "status", "TEXT NOT NULL DEFAULT 'pending'");
  ensureSqliteColumn(db, "memory_reviews", "resolved_at", "TEXT");
  ensureSqliteColumn(db, "memory_reviews", "notion_page_id", "TEXT");
  ensureSqliteColumn(db, "memory_reviews", "notion_url", "TEXT");
  ensureSqliteColumn(db, "memory_reviews", "deferred_at", "TEXT");
  const missingIds = db.prepare("SELECT family_key FROM memory_reviews WHERE review_id IS NULL OR review_id = ''").all();
  const assignId = db.prepare("UPDATE memory_reviews SET review_id = ? WHERE family_key = ?");
  for (const row of missingIds) assignId.run(`review:${randomUUID()}`, row.family_key);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_reviews_review_id ON memory_reviews(review_id);
    CREATE INDEX IF NOT EXISTS idx_memory_reviews_status ON memory_reviews(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_memory_deletions_age ON memory_deletions(vector_pending, deleted_at);
  `);
}
