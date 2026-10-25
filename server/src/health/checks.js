import { vectorEnvValue } from "../vector-settings.js";
import { isAllowed } from "../recall/admission.js";
import { randomUUID } from "node:crypto";
import { activeVectorIndex, generationCoverage, vectorDeploymentStatus } from "../vector/deployment.js";
import { qdrantHealth } from "../vector-store.js";

export { ensureHealthSchema } from "./schema.js";

export function healthStatus(db) {
  return { latest: db.prepare(`SELECT id,scope,status,created_at FROM health_runs WHERE id IN
    (SELECT id FROM (SELECT *,ROW_NUMBER() OVER (PARTITION BY scope ORDER BY created_at DESC) AS n FROM health_runs) WHERE n=1)`)
    .all(), open_findings: db.prepare("SELECT * FROM health_findings WHERE status='open' ORDER BY code").all(),
    schedule: { daily: "daily", weekly: "weekly", timezone: "server-local", managed_by: "external-scheduler" }, automatic_content_rewrite: false };
}

export function healthRuns(db, limit = 20) {
  return db.prepare("SELECT * FROM health_runs ORDER BY created_at DESC LIMIT ?").all(Math.max(1, Math.min(100, Number(limit)||20)))
    .map(({ result_json, ...row }) => ({ ...row, result: JSON.parse(result_json) }));
}

export async function runHealthCheck(db, { scope = "daily", fetchImpl, probe = true, at = new Date() } = {}) {
  if (!["daily", "weekly"].includes(scope)) throw new TypeError("Health scope must be daily or weekly");
  const checks = [];
  const add = (code, count, repair) => checks.push({ code, count: Number(count), repair });
  const count = sql => Number(db.prepare(sql).get().n);
  const integrity = db.prepare(scope === "weekly" ? "PRAGMA integrity_check" : "PRAGMA quick_check").all();
  add("sqlite-integrity", integrity.filter(row => Object.values(row)[0] !== "ok").length, "Restore a verified backup or inspect SQLite manually");
  add("foreign-keys", db.prepare("PRAGMA foreign_key_check").all().length, "Inspect the referenced records");
  add("expired-job-leases", count(`SELECT COUNT(*) n FROM portrait_jobs WHERE status='running' AND lease_until<'${at.toISOString()}'`), "Retry through the existing worker");
  add("failed-jobs", count("SELECT COUNT(*) n FROM portrait_jobs WHERE status IN ('failed','review')"), "Inspect job error and retry after correcting it");
  add("stale-job-backlog", db.prepare("SELECT COUNT(*) n FROM portrait_jobs WHERE status IN ('pending','retry') AND created_at<?")
    .get(new Date(at.getTime()-86400000).toISOString()).n, "Inspect worker configuration and pending batches");
  add("pending-vector-deletions", count("SELECT COUNT(*) n FROM memory_deletions WHERE vector_pending=1"), "Run vector sync");
  let vector = { skipped: "vector-disabled" };
  const enabled = vectorEnvValue("MOSS_RECALL_VECTOR_MODE", "off") !== "off"
    || db.prepare("SELECT 1 FROM vector_deployment WHERE id=1").get();
  if (enabled) try {
    const index = activeVectorIndex(db);
    vector = { model: index.provider.model, ...generationCoverage(db, index.identity), migration: vectorDeploymentStatus(db) };
    add("active-vector-gaps", vector.missing, "Run vector sync");
    add("migration-vector-gaps", vector.migration.generations
      .filter(generation => generation.writable && generation.identity !== index.identity)
      .reduce((sum, generation) => sum + generation.missing, 0), "Run vector sync for retained generations");
    if (probe) {
      vector.qdrant = await qdrantHealth(index.store, { fetchImpl });
      add("qdrant-unreachable", vector.qdrant.reachable ? 0 : 1, "Check Qdrant service and configured endpoint");
      // Read collection metadata without creating or changing the collection.
      const response = await (fetchImpl || fetch)(`${index.store.baseUrl}/collections/${encodeURIComponent(index.store.collection)}`, {
        headers: index.store.apiKey ? { "api-key": index.store.apiKey } : {}, signal: AbortSignal.timeout(index.store.timeoutMs) });
      const metadata = response.ok ? await response.json() : null;
      const params = metadata?.result?.config?.params?.vectors;
      add("vector-index-identity", params?.size === index.provider.dimensions && String(params?.distance).toLowerCase() === "cosine" ? 0 : 1,
        "Verify collection dimensions and migration configuration");
    }
  } catch { add("vector-configuration", 1, "Inspect embedding configuration and retained model key"); }
  if (scope === "weekly") {
    add("policy-drift", count(`SELECT COUNT(*) n FROM memories m WHERE m.status IN ('active','draft') AND (
      (m.kind='intimate-agreement' AND m.sensitivity!='intimate') OR
      EXISTS (SELECT 1 FROM audit_log a WHERE a.id=(SELECT MAX(id) FROM audit_log WHERE memory_id=m.id
        AND action IN ('commit','gateway-auto-save','policy-repair')) AND json_valid(a.snapshot_json)
        AND COALESCE(json_extract(a.snapshot_json,'$.memory.kind'),json_extract(a.snapshot_json,'$.kind'),m.kind)!=m.kind))`), "Review policy declarations without rewriting content");
    const active = db.prepare("SELECT * FROM memories WHERE status='active'").all();
    add("memory-reachability", active.filter(memory => !isAllowed(memory,
      { query: "", context: "intimate", intimacyMode: "scene" })).length, "Review policy gates for the affected records");
    const targets = { memory: ["memories", "id"], source: ["source_materials", "id"], entity: ["entities", "id"],
      handoff: ["continuity_handoffs", "id"], family: ["memories", "family_key"] };
    let arcMissing = 0, relationMissing = 0;
    for (const [type, [table, column]] of Object.entries(targets)) {
      arcMissing += db.prepare(`SELECT COUNT(*) n FROM arc_materials a WHERE material_type=? AND NOT EXISTS
        (SELECT 1 FROM ${table} t WHERE t.${column}=a.material_id)`).get(type).n;
      for (const side of ["from", "to"]) relationMissing += db.prepare(`SELECT COUNT(*) n FROM relation_assertions a WHERE ${side}_type=?
        AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.${column}=a.${side}_id)`).get(type).n;
    }
    add("arc-targets", arcMissing, "Review dangling Atlas references");
    add("relation-targets", relationMissing, "Review dangling relation endpoints");
    add("doctor-job-links", count(`SELECT COUNT(*) n FROM doctor_batches b WHERE NOT EXISTS (SELECT 1 FROM portrait_jobs j WHERE j.id=b.job_id)`), "Inspect Steward batch receipts");
    add("doctor-completion-receipts", count(`SELECT COUNT(*) n FROM doctor_batches b JOIN portrait_jobs j ON j.id=b.job_id WHERE j.status='done' AND b.receipt_json IS NULL`), "Inspect completed batch receipts");
    for (const [code, table, columns] of [
      ["family-history-json", "family_change_receipts", ["explanation_json", "before_ids_json", "after_ids_json", "evidence_json"]],
      ["capsule-json", "window_capsules", ["data_json", "source_refs_json"]],
      ["doctor-receipt-json", "doctor_batches", ["checkpoint_json", "receipt_json"]],
    ]) {
      add(code, count(`SELECT COUNT(*) n FROM ${table} WHERE ${columns.map(c => `(${c} IS NOT NULL AND NOT json_valid(${c}))`).join(" OR ")}`), "Inspect malformed structured data");
    }
    add("capsule-source-links", count(`SELECT COUNT(*) n FROM window_capsules c,json_each(CASE WHEN json_valid(c.source_refs_json) THEN c.source_refs_json ELSE '[]' END) r
      WHERE json_valid(c.source_refs_json) AND json_extract(r.value,'$.material_id') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM source_materials s WHERE s.id=json_extract(r.value,'$.material_id'))`), "Review missing capsule evidence");
  }
  const timestamp = at.toISOString(), id = randomUUID();
  const result = { checks, vector, content_rewritten: false };
  const status = checks.some(check => check.count > 0) ? "attention" : "ok";
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const check of checks) {
      if (check.count) db.prepare(`INSERT INTO health_findings VALUES (?,?,'open',?,?,?,NULL)
        ON CONFLICT(code) DO UPDATE SET status='open',count=excluded.count,last_seen_at=excluded.last_seen_at,resolved_at=NULL`)
        .run(check.code, scope, check.count, timestamp, timestamp);
      else db.prepare("UPDATE health_findings SET status='resolved',count=0,resolved_at=? WHERE code=? AND status='open'").run(timestamp, check.code);
    }
    db.prepare("INSERT INTO health_runs VALUES (?,?,?,?,?)").run(id, scope, status, JSON.stringify(result), timestamp);
    db.prepare("DELETE FROM health_runs WHERE created_at<?").run(new Date(at.getTime()-90*86400000).toISOString());
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return { id, scope, status, created_at: timestamp, ...result };
}
