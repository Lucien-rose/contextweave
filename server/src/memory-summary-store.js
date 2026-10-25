import { transaction } from "./lib/transaction.js";
import { publicError } from "./lib/error.js";
import { queueMemoryVectorJob } from "./vector-state.js";

export function summaryJobReceipt(db, id) {
  const row = db.prepare("SELECT snapshot_json FROM audit_log WHERE action='recall-summary' AND json_extract(snapshot_json, '$.derived_job_id')=? ORDER BY id DESC LIMIT 1").get(id);
  return row ? JSON.parse(row.snapshot_json).result : null;
}

export function applyMemorySummary(db, request, { jobId = null } = {}) {
  return transaction(db, () => {
    const duplicate = jobId ? summaryJobReceipt(db, jobId) : null;
    if (duplicate) return { ...duplicate, duplicate: true };
    const memory = db.prepare("SELECT * FROM memories WHERE id=? AND status!='deleted'").get(request.memory_id);
    if (!memory) throw publicError("Memory not found", 404);
    if (memory.content_hash !== request.expected_content_hash || memory.updated_at !== request.expected_updated_at) {
      throw publicError("Memory changed; read it again before summarizing", 409);
    }
    const now = new Date().toISOString();
    const publicProjection = Object.hasOwn(request, "public_projection") ? request.public_projection : memory.public_projection;
    db.prepare("UPDATE memories SET recall_summary=?, public_projection=?, updated_at=? WHERE id=?")
      .run(request.recall_summary, publicProjection, now, memory.id);
    queueMemoryVectorJob(db, memory.id);
    const result = { memory_id: memory.id, recall_summary: request.recall_summary, content_hash: memory.content_hash,
      updated_at: now, canonical_content_changed: false, lifecycle_changed: false };
    const snapshot = { before: { recall_summary: memory.recall_summary, public_projection: memory.public_projection },
      after: { recall_summary: request.recall_summary, public_projection: publicProjection }, content_hash: memory.content_hash };
    if (jobId) Object.assign(snapshot, { derived_job_id: jobId, result });
    db.prepare("INSERT INTO audit_log(memory_id, action, snapshot_json, created_at) VALUES (?, 'recall-summary', ?, ?)")
      .run(memory.id, JSON.stringify(snapshot), now);
    return result;
  });
}
