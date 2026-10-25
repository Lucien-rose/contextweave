import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { safeJsonArray, safeJsonObject } from "./lib/json.js";
import { withMemoryEvidence } from "./memory-evidence.js";
import { queueMemoryVectorJob } from "./vector-state.js";
import { readSourceMaterial, recordSourceMaterial } from "./source-materials.js";
import { refreshFts } from "./database-projections.js";
import { migrateDatabase } from "./database-migrations.js";
import {
  declaredPolicyDefaults, contentHash, REPAIRABLE_MEMORY_KINDS, REPAIRABLE_SENSITIVITIES,
  REPAIRABLE_SCOPES, REPAIRABLE_ACTIVATION_POLICIES, REPAIRABLE_LOAD_POLICIES,
} from "./memory-record.js";
import { normalizeMemorySummaries } from "./memory-summary.js";
import { hydrateMemory as hydrate } from "./database-record.js";
export { searchMemoriesFtsShadow, searchMemoriesSituationShadow } from "./database-projections.js";

export function resolveDatabasePath(input) {
  const path = input || process.env.MOSS_DB_PATH || "data/moss-memory.sqlite";
  return path === ":memory:" ? path : resolve(path);
}

export function openDatabase(inputPath) {
  const dbPath = resolveDatabasePath(inputPath);
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  migrateDatabase(db);
  return { db, dbPath };
}

export function writeMemory(db, memory) {
  const now = new Date().toISOString();
  const explicitlyDeclaredPolicy = ["scope", "activation_policy", "egress_policy"]
    .some((field) => Object.prototype.hasOwnProperty.call(memory, field));
  const row = {
    external_id: null,
    layer: "archive",
    kind: "memory",
    event_date: null,
    tags: [],
    triggers: [],
    sensitivity: "private",
    mentionability: "contextual",
    importance: 50,
    status: "active",
    source_file: null,
    source_hash: null,
    source_section: null,
    supersedes_id: null,
    family_key: null,
    content_hash: null,
    safe_projection: null,
    recall_summary: null,
    public_projection: null,
    version: 1,
    load_policy: "contextual",
    standing_opt_in: false,
    ambient_triggers: [],
    scope: null,
    activation_policy: null,
    egress_policy: null,
    policy_origin: null,
    created_at: now,
    updated_at: now,
    ...memory,
  };

  row.tags = Array.isArray(row.tags) ? row.tags : safeJsonArray(row.tags_json);
  if (db.prepare("SELECT 1 FROM memory_deletions WHERE memory_id = ?").get(row.id)) {
    throw new TypeError("Deleted memory IDs cannot be reused");
  }
  row.triggers = Array.isArray(row.triggers) ? row.triggers : safeJsonArray(row.triggers_json);
  row.ambient_triggers = Array.isArray(row.ambient_triggers)
    ? row.ambient_triggers
    : safeJsonArray(row.ambient_triggers_json);
  row.family_key = String(row.family_key || `memory:${row.id}`);
  row.content_hash = contentHash(row.content);
  row.version = Math.max(1, Number(row.version) || 1);
  row.load_policy = String(row.load_policy || (row.layer === "core" ? "deep-rotate" : "contextual"));
  row.standing_opt_in = row.standing_opt_in ? 1 : 0;
  const policy = declaredPolicyDefaults(row);
  row.scope = String(row.scope || policy.scope);
  row.activation_policy = String(row.activation_policy || policy.activation_policy);
  row.egress_policy = String(row.egress_policy || policy.egress_policy);
  row.policy_origin = String(row.policy_origin || (explicitlyDeclaredPolicy ? "explicit" : "derived-write-default"));

  const existing = db.prepare("SELECT created_at, content_hash, recall_summary, public_projection FROM memories WHERE id = ?").get(row.id);
  if (existing) row.created_at = existing.created_at;
  const previous = existing || (row.supersedes_id
    ? db.prepare("SELECT content_hash, recall_summary, public_projection FROM memories WHERE id = ?").get(row.supersedes_id) : null);
  normalizeMemorySummaries(row, memory, previous);

  db.prepare(`
    INSERT INTO memories (
      id, external_id, layer, kind, title, content, event_date,
      tags_json, triggers_json, sensitivity, mentionability, importance,
      status, source_file, source_hash, source_section, supersedes_id,
      family_key, content_hash, version, load_policy, standing_opt_in,
      ambient_triggers_json, scope, activation_policy, egress_policy,
      policy_origin, safe_projection, created_at, updated_at, recall_summary, public_projection
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      external_id=excluded.external_id,
      layer=excluded.layer,
      kind=excluded.kind,
      title=excluded.title,
      content=excluded.content,
      event_date=excluded.event_date,
      tags_json=excluded.tags_json,
      triggers_json=excluded.triggers_json,
      sensitivity=excluded.sensitivity,
      mentionability=excluded.mentionability,
      importance=excluded.importance,
      status=excluded.status,
      source_file=excluded.source_file,
      source_hash=excluded.source_hash,
      source_section=excluded.source_section,
      supersedes_id=excluded.supersedes_id,
      family_key=excluded.family_key,
      content_hash=excluded.content_hash,
      version=excluded.version,
      load_policy=excluded.load_policy,
      standing_opt_in=excluded.standing_opt_in,
      ambient_triggers_json=excluded.ambient_triggers_json,
      scope=excluded.scope,
      activation_policy=excluded.activation_policy,
      egress_policy=excluded.egress_policy,
      policy_origin=excluded.policy_origin,
      safe_projection=excluded.safe_projection,
      recall_summary=excluded.recall_summary,
      public_projection=excluded.public_projection,
      updated_at=excluded.updated_at
  `).run(
    row.id, row.external_id, row.layer, row.kind, row.title, row.content,
    row.event_date, JSON.stringify(row.tags), JSON.stringify(row.triggers),
    row.sensitivity, row.mentionability, row.importance, row.status,
    row.source_file, row.source_hash, row.source_section, row.supersedes_id,
    row.family_key, row.content_hash, row.version, row.load_policy, row.standing_opt_in,
    JSON.stringify(row.ambient_triggers), row.scope, row.activation_policy,
    row.egress_policy, row.policy_origin, row.safe_projection || null,
    row.created_at, row.updated_at,
    row.recall_summary || null, row.public_projection || null,
  );
  refreshFts(db, row.id);
  queueMemoryVectorJob(db, row.id);
  if (row.supersedes_id) db.prepare(`INSERT OR IGNORE INTO memory_starfields(memory_id, starfield, assigned_by, updated_at)
    SELECT ?, starfield, assigned_by, ? FROM memory_starfields WHERE memory_id = ?`)
    .run(row.id, now, row.supersedes_id);
  return getMemory(db, row.id);
}

export function getMemory(db, id) {
  const row = db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
  return row ? withMemoryEvidence(db, hydrate(row)) : null;
}

export function listMemories(db, { status = "active" } = {}) {
  return db.prepare("SELECT * FROM memories WHERE status = ? ORDER BY id ASC").all(status).map(hydrate);
}

export { listMemoriesForAdmin } from "./database-admin.js";

export function memoryStats(db) {
  const statusRows = db.prepare("SELECT status, COUNT(*) AS count FROM memories GROUP BY status").all();
  const activeRows = db.prepare("SELECT layer, COUNT(*) AS count FROM memories WHERE status = 'active' GROUP BY layer").all();
  const kindRows = db.prepare("SELECT kind, COUNT(*) AS count FROM memories WHERE status = 'active' GROUP BY kind").all();
  return {
    total: Number(db.prepare("SELECT COUNT(*) AS count FROM memories").get().count),
    statuses: Object.fromEntries(statusRows.map((row) => [row.status, Number(row.count)])),
    layers: Object.fromEntries(activeRows.map((row) => [row.layer, Number(row.count)])),
    kinds: Object.fromEntries(kindRows.map((row) => [row.kind, Number(row.count)])),
    safe_projection: {
      eligible: Number(db.prepare(`SELECT COUNT(*) AS count FROM memories
        WHERE status = 'active' AND sensitivity IN ('sensitive', 'intimate')`).get().count),
      available: Number(db.prepare(`SELECT COUNT(*) AS count FROM memories
        WHERE status = 'active' AND sensitivity IN ('sensitive', 'intimate')
          AND safe_projection IS NOT NULL AND TRIM(safe_projection) <> ''`).get().count),
    },
  };
}

export function memoryPolicyAudit(db) {
  const rows = db.prepare(`
    SELECT id, kind, policy_origin FROM memories WHERE status IN ('active', 'draft')
  `).all();
  const originCounts = {};
  const suspectedKindDrift = [];
  const latestCommit = db.prepare(`
    SELECT action, snapshot_json FROM audit_log
    WHERE memory_id = ? AND action IN ('commit', 'gateway-auto-save', 'policy-repair')
    ORDER BY id DESC LIMIT 1
  `);
  for (const row of rows) {
    const origin = row.policy_origin || "missing";
    originCounts[origin] = (originCounts[origin] || 0) + 1;
    const auditRow = latestCommit.get(row.id);
    if (!auditRow?.snapshot_json) continue;
    const snapshot = safeJsonObject(auditRow.snapshot_json);
    const explicit = auditRow.action === "gateway-auto-save" ? snapshot.memory : snapshot;
    if (!explicit?.kind || explicit.kind === row.kind) continue;
    suspectedKindDrift.push({
      id: row.id,
      current_kind: row.kind,
      last_explicit_kind: explicit.kind,
      last_explicit_action: auditRow.action,
    });
  }
  return {
    checked_records: rows.length,
    policy_origins: originCounts,
    suspected_kind_drift: suspectedKindDrift,
  };
}

export function repairMemoryPolicy(db, memoryId, patch, {
  apply = false,
  confirmation = "",
} = {}) {
  const current = getMemory(db, memoryId);
  if (!current) throw new TypeError(`Memory not found: ${memoryId}`);
  const normalized = normalizePolicyRepairPatch(patch);
  const ambientTriggers = [...new Set([
    ...current.ambient_triggers.filter((value) => !normalized.remove_ambient_triggers.includes(value)),
    ...normalized.add_ambient_triggers,
  ])];
  const next = {
    ...current,
    ...normalized.fields,
    ambient_triggers: ambientTriggers,
    policy_origin: "explicit-repair",
  };
  const changedFields = [
    ...Object.keys(normalized.fields),
    ...(ambientTriggers.length !== current.ambient_triggers.length ? ["ambient_triggers"] : []),
    ...(current.policy_origin !== "explicit-repair" ? ["policy_origin"] : []),
  ].filter((field) => JSON.stringify(current[field]) !== JSON.stringify(next[field]));
  const receipt = {
    memory_id: memoryId,
    mode: apply ? "apply" : "dry-run",
    changed_fields: changedFields,
    before: policyRepairSummary(current),
    after: policyRepairSummary(next),
  };
  if (!apply) return receipt;
  if (confirmation !== memoryId) {
    throw new TypeError("Apply requires --confirmation to exactly match the memory id");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    audit(db, current.id, "pre-policy-repair", current);
    const repaired = writeMemory(db, next);
    audit(db, repaired.id, "policy-repair", repaired);
    db.exec("COMMIT");
    return { ...receipt, after: policyRepairSummary(repaired), audited: true };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function normalizePolicyRepairPatch(patch = {}) {
  const fields = {};
  const validators = {
    kind: REPAIRABLE_MEMORY_KINDS,
    sensitivity: REPAIRABLE_SENSITIVITIES,
    scope: REPAIRABLE_SCOPES,
    activation_policy: REPAIRABLE_ACTIVATION_POLICIES,
    load_policy: REPAIRABLE_LOAD_POLICIES,
  };
  for (const [field, allowed] of Object.entries(validators)) {
    if (patch[field] == null) continue;
    const value = String(patch[field]);
    if (!allowed.has(value)) throw new TypeError(`Invalid ${field}: ${value}`);
    fields[field] = value;
  }
  if (patch.egress_policy != null) {
    if (patch.egress_policy !== "local_only") throw new TypeError("egress_policy must be local_only");
    fields.egress_policy = "local_only";
  }
  if (patch.standing_opt_in != null) fields.standing_opt_in = Boolean(patch.standing_opt_in);
  const addAmbientTriggers = Array.isArray(patch.add_ambient_triggers)
    ? [...new Set(patch.add_ambient_triggers.map((value) => String(value).trim()).filter(Boolean))]
    : [];
  const removeAmbientTriggers = Array.isArray(patch.remove_ambient_triggers)
    ? [...new Set(patch.remove_ambient_triggers.map((value) => String(value).trim()).filter(Boolean))]
    : [];
  if ([...addAmbientTriggers, ...removeAmbientTriggers].some((value) => value.length > 120)) {
    throw new TypeError("ambient trigger must be at most 120 characters");
  }
  return {
    fields,
    add_ambient_triggers: addAmbientTriggers,
    remove_ambient_triggers: removeAmbientTriggers,
  };
}

function policyRepairSummary(memory) {
  return {
    id: memory.id,
    kind: memory.kind,
    sensitivity: memory.sensitivity,
    scope: memory.scope,
    activation_policy: memory.activation_policy,
    standing_opt_in: Boolean(memory.standing_opt_in),
    load_policy: memory.load_policy,
    egress_policy: memory.egress_policy,
    policy_origin: memory.policy_origin,
    ambient_triggers: memory.ambient_triggers,
  };
}

export function archiveMemory(db, memoryId) {
  const memory = getMemory(db, memoryId);
  if (!memory || !["active", "draft"].includes(memory.status)) return null;
  db.exec("BEGIN IMMEDIATE");
  try {
    audit(db, memory.id, "pre-archive", memory);
    const archived = writeMemory(db, {
      ...memory,
      status: "archived",
      updated_at: new Date().toISOString(),
    });
    audit(db, archived.id, "archive", archived);
    db.exec("COMMIT");
    return archived;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function markRecalled(db, ids) {
  if (!ids.length) return;
  const stmt = db.prepare(`
    UPDATE memories
    SET last_recalled_at = ?, recall_count = recall_count + 1
    WHERE id = ?
  `);
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    for (const id of ids) stmt.run(now, id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function audit(db, memoryId, action, snapshot) {
  db.prepare(`
    INSERT INTO audit_log(memory_id, action, snapshot_json, created_at)
    VALUES (?, ?, ?, ?)
  `).run(memoryId, action, snapshot ? JSON.stringify(snapshot) : null, new Date().toISOString());
}

export function replaceObservances(db, memoryId, observances) {
  db.prepare("DELETE FROM observances WHERE memory_id = ?").run(memoryId);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO observances(memory_id, label, exact_date, month_day, recurring)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const item of observances) {
    insert.run(memoryId, item.label, item.exact_date || null, item.month_day || null, item.recurring === false ? 0 : 1);
  }
}

export function listObservances(db) {
  return db.prepare(`
    SELECT o.*, m.title, m.content, m.layer, m.kind, m.event_date, m.tags_json,
           m.triggers_json, m.sensitivity, m.mentionability, m.importance,
           m.status, m.source_file, m.source_section, m.external_id,
           m.last_recalled_at, m.recall_count, m.family_key, m.content_hash,
           m.version, m.load_policy, m.standing_opt_in, m.ambient_triggers_json,
           m.scope, m.activation_policy, m.egress_policy, m.policy_origin,
           m.supersedes_id, m.safe_projection, m.recall_summary, m.public_projection
    FROM observances o
    JOIN memories m ON m.id = o.memory_id
    WHERE m.status = 'active'
  `).all().map((row) => ({
    ...row,
    id: row.memory_id,
    tags: safeJsonArray(row.tags_json),
    triggers: safeJsonArray(row.triggers_json),
    ambient_triggers: safeJsonArray(row.ambient_triggers_json),
    standing_opt_in: Boolean(row.standing_opt_in),
  }));
}

export function createMemoryCandidate(db, candidate) {
  const now = new Date().toISOString();
  const row = {
    event_date: null,
    tags: [],
    triggers: [],
    sensitivity: "private",
    mentionability: "contextual",
    importance: 50,
    confidence: 0,
    meaning_score: 0,
    policy_reasons: [],
    status: "review",
    base_memory_id: null,
    memory_id: null,
    processed_at: null,
    safe_projection: null,
    source_refs: [],
    created_at: now,
    updated_at: now,
    ...candidate,
  };
  row.tags = Array.isArray(row.tags) ? row.tags : [];
  row.triggers = Array.isArray(row.triggers) ? row.triggers : [];
  row.policy_reasons = Array.isArray(row.policy_reasons) ? row.policy_reasons : [];
  row.source_refs = Array.isArray(row.source_refs) ? row.source_refs : [];

  db.prepare(`
    INSERT OR IGNORE INTO memory_candidates (
      id, candidate_kind, title, content, event_date, tags_json, triggers_json,
      sensitivity, mentionability, importance, confidence, meaning_score,
      fingerprint, policy_decision, policy_reasons_json, status,
      base_memory_id, memory_id, safe_projection, created_at, processed_at, updated_at, recall_summary, public_projection
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.candidate_kind, row.title, row.content, row.event_date,
    JSON.stringify(row.tags), JSON.stringify(row.triggers), row.sensitivity,
    row.mentionability, row.importance, row.confidence, row.meaning_score,
    row.fingerprint, row.policy_decision, JSON.stringify(row.policy_reasons),
    row.status, row.base_memory_id, row.memory_id, row.safe_projection, row.created_at,
    row.processed_at, row.updated_at,
    row.recall_summary || row.safe_projection || null, row.public_projection || null,
  );

  const stored = db.prepare("SELECT id FROM memory_candidates WHERE fingerprint = ?")
    .get(row.fingerprint);
  if (!stored) return null;
  const insertSource = db.prepare(`
    INSERT OR IGNORE INTO memory_source_refs (
      candidate_id, source_type, source_id, excerpt, occurred_at,
      metadata_json, material_id, source_hash, written_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const source of row.source_refs) {
    const material = recordSourceMaterial(db, source);
    insertSource.run(
      stored.id,
      String(source.source_type || "unknown"),
      String(source.source_id || "unknown"),
      source.excerpt || null,
      source.occurred_at || null,
      JSON.stringify(source.metadata || {}),
      material?.id || source.material_id || null,
      source.source_hash || material?.content_hash || null,
      source.written_at || material?.written_at || null,
      now,
    );
  }
  return getMemoryCandidate(db, stored.id);
}

export function getMemoryCandidate(db, id) {
  const row = db.prepare("SELECT * FROM memory_candidates WHERE id = ?").get(id);
  return row ? hydrateCandidate(db, row) : null;
}

export function getMemoryCandidateByFingerprint(db, fingerprint) {
  const row = db.prepare("SELECT * FROM memory_candidates WHERE fingerprint = ?").get(fingerprint);
  return row ? hydrateCandidate(db, row) : null;
}

export function listMemoryCandidates(db, { status = "all", limit = 100, offset = 0 } = {}) {
  const safeLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const rows = status === "all"
    ? db.prepare("SELECT * FROM memory_candidates ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(safeLimit, safeOffset)
    : db.prepare("SELECT * FROM memory_candidates WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(status, safeLimit, safeOffset);
  return rows.map((row) => hydrateCandidate(db, row));
}

export function updateMemoryCandidate(db, id, changes) {
  const current = getMemoryCandidate(db, id);
  if (!current) return null;
  const next = {
    status: changes.status ?? current.status,
    memory_id: changes.memory_id ?? current.memory_id,
    processed_at: changes.processed_at ?? current.processed_at,
    updated_at: new Date().toISOString(),
  };
  db.prepare(`
    UPDATE memory_candidates
    SET status = ?, memory_id = ?, processed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(next.status, next.memory_id, next.processed_at, next.updated_at, id);
  return getMemoryCandidate(db, id);
}

function hydrateCandidate(db, row) {
  const sourceRefs = db.prepare(`
    SELECT source_type, source_id, excerpt, occurred_at, metadata_json,
           material_id, source_hash, written_at
    FROM memory_source_refs WHERE candidate_id = ? ORDER BY id
  `).all(row.id).map((source) => {
    const material = source.material_id ? readSourceMaterial(db, source.material_id) : null;
    return {
      source_type: source.source_type,
      source_id: source.source_id,
      excerpt: source.excerpt,
      occurred_at: source.occurred_at,
      written_at: source.written_at,
      source_hash: source.source_hash,
      material_id: source.material_id,
      metadata: safeJsonObject(source.metadata_json),
      ...(material ? { source_context: {
        content: material.content,
        speaker: material.speaker,
        conversation_id: material.conversation_id,
        window_id: material.window_id,
        message_id: material.message_id,
        occurred_at: material.occurred_at,
        written_at: material.written_at,
        sensitivity: material.sensitivity,
      } } : {}),
    };
  });
  return {
    ...row,
    tags: safeJsonArray(row.tags_json),
    triggers: safeJsonArray(row.triggers_json),
    policy_reasons: safeJsonArray(row.policy_reasons_json),
    source_refs: sourceRefs,
  };
}


