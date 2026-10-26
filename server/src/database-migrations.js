import { ensureVectorDeploymentSchema } from "./vector/schema.js";
import { ensureHealthSchema } from "./health/schema.js";
import { ensureWindowCapsuleSchema } from "./window/schema.js";
import { ensureDoctorSchema } from "./doctor/schema.js";
import { safeJsonArray } from "./lib/json.js";
import { ensureDatabaseSchema } from "./database-schema.js";
import { ensureArcSchema } from "./arc/schema.js";
import { ensureEntitySchema } from "./entity/schema.js";
import { ensureRelationSchema } from "./relation/schema.js";
import { ensureFamilySchema } from "./family/schema.js";
import { migrateFamilyHistory } from "./family/history.js";
import { ensureStarfieldSchema } from "./starfield/schema.js";
import { ensureRecallCooldown } from "./recall/cooldown.js";
import { ensureRecallSettings } from "./recall/settings.js";
import { ensurePortraitSchema } from "./portrait/schema.js";
import { ensureSqliteColumn } from "./lib/sqlite.js";
import { migrateProvenance } from "./source-materials.js";
import { insertFtsShadowRow, insertSituationShadowRow } from "./database-projections.js";
import { declaredPolicyDefaults, contentHash } from "./memory-record.js";

export function migrateDatabase(db) {
  ensureDatabaseSchema(db);
  ensureRecallCooldown(db);
  ensureVectorDeploymentSchema(db);
  ensureHealthSchema(db);

  ensureSqliteColumn(db, "memories", "family_key", "TEXT");
  ensureSqliteColumn(db, "memories", "content_hash", "TEXT");
  ensureSqliteColumn(db, "memories", "version", "INTEGER NOT NULL DEFAULT 1");
  ensureSqliteColumn(db, "memories", "load_policy", "TEXT NOT NULL DEFAULT 'contextual'");
  ensureSqliteColumn(db, "memories", "standing_opt_in", "INTEGER NOT NULL DEFAULT 0");
  ensureSqliteColumn(db, "memories", "ambient_triggers_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureSqliteColumn(db, "memories", "scope", "TEXT");
  ensureSqliteColumn(db, "memories", "activation_policy", "TEXT");
  ensureSqliteColumn(db, "memories", "egress_policy", "TEXT");
  ensureSqliteColumn(db, "memories", "policy_origin", "TEXT");
  migrateProvenance(db);
  ensureMemorySummaries(db);
  ensureRecallSettings(db);
  ensurePortraitSchema(db);
  ensureWindowCapsuleSchema(db);
  ensureDoctorSchema(db);
  ensureArcSchema(db);
  ensureEntitySchema(db);
  ensureRelationSchema(db);
  ensureFamilySchema(db);
  migrateFamilyHistory(db);
  ensureStarfieldSchema(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_family_key ON memories(family_key);
    CREATE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash);
    CREATE INDEX IF NOT EXISTS idx_memories_load_policy ON memories(load_policy);
  `);
  backfillRecallV2Metadata(db);
  backfillFtsShadow(db);
  backfillSituationShadow(db);
  dropLegacySituationShadow(db);
}

function ensureMemorySummaries(db) {
  const migrated = db.prepare("PRAGMA table_info(memories)").all().some((row) => row.name === "recall_summary");
  for (const table of ["memories", "memory_candidates"]) {
    ensureSqliteColumn(db, table, "recall_summary", "TEXT");
    ensureSqliteColumn(db, table, "public_projection", "TEXT");
  }
  // Preserve legacy text once, without retaining the former gate-bypass rule.
  if (!migrated) {
    for (const table of ["memories", "memory_candidates"]) {
      db.exec(`UPDATE ${table} SET recall_summary = safe_projection WHERE safe_projection IS NOT NULL`);
    }
  }
}

function backfillFtsShadow(db) {
  const rows = db.prepare(`
    SELECT id, title, content, tags_json, triggers_json
    FROM memories
    WHERE NOT EXISTS (
      SELECT 1 FROM memories_fts_shadow f WHERE f.memory_id = memories.id
    )
  `).all();
  if (!rows.length) return;
  const insert = db.prepare(`
    INSERT INTO memories_fts_shadow(memory_id, title, content, tags, triggers)
    VALUES (?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) insertFtsShadowRow(insert, row);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function backfillSituationShadow(db) {
  const rows = db.prepare(`
    SELECT id, title, content, tags_json, triggers_json, ambient_triggers_json
    FROM memories
    WHERE NOT EXISTS (
      SELECT 1 FROM memories_situation_shadow_v2 f WHERE f.memory_id = memories.id
    )
  `).all();
  if (!rows.length) return;
  const insert = db.prepare(`
    INSERT INTO memories_situation_shadow_v2(
      memory_id, title, body, metadata, ambient
    ) VALUES (?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) insertSituationShadowRow(insert, row);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function dropLegacySituationShadow(db) {
  // v1 contains derived concept IDs only. The updater preserves the complete
  // pre-migration data directory, so removing this obsolete cache is both
  // bounded and fully recoverable during rollback.
  db.exec("DROP TABLE IF EXISTS memories_situation_shadow_v1");
}

function backfillRecallV2Metadata(db) {
  const rows = db.prepare(`
    SELECT id, title, content, layer, kind, sensitivity, triggers_json,
           family_key, content_hash, version, load_policy, standing_opt_in,
           ambient_triggers_json, scope, activation_policy, egress_policy,
           policy_origin
    FROM memories
    WHERE family_key IS NULL OR content_hash IS NULL OR version IS NULL OR load_policy IS NULL
      OR scope IS NULL OR activation_policy IS NULL OR egress_policy IS NULL OR policy_origin IS NULL
  `).all();
  if (!rows.length) return;
  const update = db.prepare(`
    UPDATE memories
    SET family_key = ?, content_hash = ?, version = ?, load_policy = ?,
        standing_opt_in = ?, ambient_triggers_json = ?, scope = ?,
        activation_policy = ?, egress_policy = ?, policy_origin = ?
    WHERE id = ?
  `);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const triggers = safeJsonArray(row.triggers_json);
      const policy = declaredPolicyDefaults(row);
      update.run(
        row.family_key || `memory:${row.id}`,
        row.content_hash || contentHash(row.content),
        Math.max(1, Number(row.version) || 1),
        row.load_policy || (row.kind === "intimate-agreement" ? "manifest-always" : (row.layer === "core" ? "deep-rotate" : "contextual")),
        row.standing_opt_in ? 1 : 0,
        row.ambient_triggers_json && row.ambient_triggers_json !== "[]"
          ? row.ambient_triggers_json
          : JSON.stringify(triggers),
        row.scope || policy.scope,
        row.activation_policy || policy.activation_policy,
        row.egress_policy || policy.egress_policy,
        row.policy_origin || "legacy-compat",
        row.id,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

