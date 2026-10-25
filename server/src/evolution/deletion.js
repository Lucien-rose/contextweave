import { getMemory } from "../database.js";
import { transaction } from "../lib/transaction.js";
import { publicError } from "../lib/error.js";
import { deletionSchema, parseContract } from "./contract.js";
import { flushVectorDeletions } from "./vector-deletion.js";
import { purgeMemoryPortraitDerivatives } from "../portrait/deletion.js";
import { redactFamilyHistory } from "../family/history.js";

export async function deleteMemory(db, input, options = {}) {
  const request = parseContract(deletionSchema, input);
  transaction(db, () => deleteCanonical(db, request));
  const cleanup = await flushVectorDeletions(db, options);
  return { deleted: true, memory_id: request.memory_id, recoverable: false,
    vector_cleanup: cleanup.status, backup_erasure: "not_included" };
}

function deleteCanonical(db, request) {
  const id = request.memory_id;
  const memory = getMemory(db, id);
  if (!memory) {
    if (db.prepare("SELECT 1 FROM memory_deletions WHERE memory_id = ?").get(id)) return;
    throw publicError("Memory not found", 404);
  }
  if (memory.content_hash !== request.expected_content_hash || memory.updated_at !== request.expected_updated_at) {
    throw publicError("Memory changed; inspect it again before deletion", 409);
  }
  // Delete only this record. Siblings survive and no historical state is promoted.
  db.prepare("UPDATE memories SET supersedes_id = NULL, updated_at = ? WHERE supersedes_id = ?")
    .run(new Date().toISOString(), id);
  db.prepare("DELETE FROM memory_candidates WHERE base_memory_id = ? AND memory_id IS NULL").run(id);
  db.prepare("UPDATE memory_candidates SET base_memory_id = NULL, status = 'review' WHERE base_memory_id = ? AND memory_id != ?").run(id, id);
  db.prepare("DELETE FROM memory_candidates WHERE memory_id = ?").run(id);
  for (const table of ["memories_fts", "memories_fts_shadow", "memories_situation_shadow_v2"]) {
    db.prepare(`DELETE FROM ${table} WHERE memory_id = ?`).run(id);
  }
  db.prepare("DELETE FROM audit_log WHERE memory_id = ?").run(id);
  purgeMemoryPortraitDerivatives(db, id);
  redactFamilyHistory(db, id);
  // Old receipts can contain nested before/after bodies, including other records' snapshots.
  scrubSnapshots(db, id);
  db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  db.prepare("INSERT INTO memory_deletions VALUES (?, ?, 'explicit-user', 1)")
    .run(id, new Date().toISOString());
}

function scrubSnapshots(db, id) {
  const snapshots = db.prepare("SELECT id, snapshot_json FROM audit_log WHERE snapshot_json IS NOT NULL").all();
  for (const row of snapshots) {
    if (containsId(JSON.parse(row.snapshot_json), id)) db.prepare("UPDATE audit_log SET snapshot_json = NULL WHERE id = ?").run(row.id);
  }
  const changes = db.prepare("SELECT * FROM memory_changes").all();
  for (const row of changes) {
    if (row.memory_id === id || row.target_id === id
      || containsId(JSON.parse(row.before_json || "[]"), id) || containsId(JSON.parse(row.after_json || "[]"), id)) {
      db.prepare("UPDATE memory_changes SET before_json = NULL, after_json = NULL, status = 'deleted' WHERE id = ?").run(row.id);
    }
  }
  for (const row of db.prepare("SELECT * FROM memory_reviews").all()) {
    if (containsId(JSON.parse(row.intent_json), id)) {
      const now = new Date().toISOString();
      db.prepare(`UPDATE memory_reviews
        SET intent_json = '{}', reason = '关联记忆已永久删除', status = 'dismissed',
            resolved_at = ?, updated_at = ? WHERE family_key = ?`).run(now, now, row.family_key);
    }
  }
}

function containsId(value, id) {
  if (value === id) return true;
  return value && typeof value === "object" && Object.values(value).some((child) => containsId(child, id));
}
