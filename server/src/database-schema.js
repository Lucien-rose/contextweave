import { migrateHandoffs } from "./continuity-handoffs.js";
import { migrateRetention } from "./continuity-retention.js";
import { ensureEvolutionSchema } from "./evolution/schema.js";
import { ensureProvenanceSchema } from "./provenance-schema.js";

export function ensureDatabaseSchema(db) {
  ensureEvolutionSchema(db);
  ensureProvenanceSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      external_id TEXT,
      layer TEXT NOT NULL DEFAULT 'archive',
      kind TEXT NOT NULL DEFAULT 'memory',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      safe_projection TEXT,
      event_date TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      triggers_json TEXT NOT NULL DEFAULT '[]',
      sensitivity TEXT NOT NULL DEFAULT 'private',
      mentionability TEXT NOT NULL DEFAULT 'contextual',
      importance INTEGER NOT NULL DEFAULT 50 CHECK (importance BETWEEN 0 AND 100),
      status TEXT NOT NULL DEFAULT 'active',
      source_file TEXT,
      source_hash TEXT,
      source_section TEXT,
      supersedes_id TEXT REFERENCES memories(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_recalled_at TEXT,
      recall_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
    CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer);
    CREATE INDEX IF NOT EXISTS idx_memories_event_date ON memories(event_date);

    CREATE TABLE IF NOT EXISTS recall_deliveries (
      id TEXT PRIMARY KEY,
      selected_json TEXT NOT NULL,
      delivered_ids_json TEXT,
      created_at TEXT NOT NULL,
      delivered_at TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_relations (
      source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      PRIMARY KEY (source_id, target_id, relation)
    );

    CREATE TABLE IF NOT EXISTS memory_vector_state (
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      index_identity TEXT NOT NULL,
      collection_name TEXT NOT NULL,
      projection_hash TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      PRIMARY KEY (memory_id, index_identity)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_vector_state_identity
      ON memory_vector_state(index_identity, indexed_at);

    CREATE TABLE IF NOT EXISTS memory_vector_jobs (
      memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
      queued_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memory_vector_jobs_queued
      ON memory_vector_jobs(queued_at, memory_id);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL,
      action TEXT NOT NULL,
      snapshot_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS observances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      exact_date TEXT,
      month_day TEXT,
      recurring INTEGER NOT NULL DEFAULT 1,
      UNIQUE(memory_id, label, exact_date, month_day)
    );

    CREATE INDEX IF NOT EXISTS idx_observances_exact_date ON observances(exact_date);
    CREATE INDEX IF NOT EXISTS idx_observances_month_day ON observances(month_day);

    CREATE TABLE IF NOT EXISTS memory_candidates (
      id TEXT PRIMARY KEY,
      candidate_kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      safe_projection TEXT,
      event_date TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      triggers_json TEXT NOT NULL DEFAULT '[]',
      sensitivity TEXT NOT NULL DEFAULT 'private',
      mentionability TEXT NOT NULL DEFAULT 'contextual',
      importance INTEGER NOT NULL DEFAULT 50 CHECK (importance BETWEEN 0 AND 100),
      confidence REAL NOT NULL DEFAULT 0,
      meaning_score REAL NOT NULL DEFAULT 0,
      fingerprint TEXT NOT NULL UNIQUE,
      policy_decision TEXT NOT NULL,
      policy_reasons_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      base_memory_id TEXT REFERENCES memories(id),
      memory_id TEXT REFERENCES memories(id),
      created_at TEXT NOT NULL,
      processed_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_source_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id TEXT NOT NULL REFERENCES memory_candidates(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      excerpt TEXT,
      occurred_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      material_id TEXT REFERENCES source_materials(id),
      source_hash TEXT,
      written_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(candidate_id, source_type, source_id)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_candidates_status
      ON memory_candidates(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_candidates_kind
      ON memory_candidates(candidate_kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_source_refs_candidate
      ON memory_source_refs(candidate_id, id);

    CREATE TABLE IF NOT EXISTS memory_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      excerpt TEXT,
      occurred_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      material_id TEXT REFERENCES source_materials(id),
      source_hash TEXT,
      written_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(memory_id, source_type, source_id)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_evidence_memory
      ON memory_evidence(memory_id, id);

    CREATE TABLE IF NOT EXISTS continuity_handoffs (
      id TEXT PRIMARY KEY,
      source_surface TEXT NOT NULL,
      source_session_id TEXT NOT NULL,
      current_topic TEXT NOT NULL,
      decisions_json TEXT NOT NULL DEFAULT '[]',
      unresolved_intent TEXT,
      emotional_position TEXT,
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      sensitivity TEXT NOT NULL DEFAULT 'private',
      status TEXT NOT NULL DEFAULT 'active',
      supersedes_id TEXT REFERENCES continuity_handoffs(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scene_capsules (
      id TEXT PRIMARY KEY,
      source_surface TEXT NOT NULL,
      source_session_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      setting TEXT,
      continuity_state_json TEXT NOT NULL DEFAULT '{}',
      unfinished_beat TEXT NOT NULL,
      anchor_quotes_json TEXT NOT NULL DEFAULT '[]',
      sensitivity TEXT NOT NULL DEFAULT 'intimate',
      started_at TEXT NOT NULL,
      last_touched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      suspended_at TEXT,
      closed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS continuity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT NOT NULL UNIQUE,
      event_kind TEXT NOT NULL,
      source_surface TEXT NOT NULL,
      source_session_id TEXT NOT NULL,
      sensitivity TEXT NOT NULL DEFAULT 'private',
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS continuity_clients (
      client_id TEXT PRIMARY KEY,
      surface TEXT NOT NULL,
      last_event_id INTEGER NOT NULL DEFAULT 0,
      last_session_id TEXT,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_continuity_handoffs_status
      ON continuity_handoffs(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scene_capsules_status
      ON scene_capsules(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scene_capsules_expiry
      ON scene_capsules(status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_continuity_events_cursor
      ON continuity_events(id, created_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      memory_id UNINDEXED,
      title,
      content,
      tags,
      triggers,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts_shadow USING fts5(
      memory_id UNINDEXED,
      title,
      content,
      tags,
      triggers,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_situation_shadow_v2 USING fts5(
      memory_id UNINDEXED,
      title,
      body,
      metadata,
      ambient,
      tokenize = 'unicode61 remove_diacritics 2'
    );

  `);
  migrateHandoffs(db);
  migrateRetention(db);
}
