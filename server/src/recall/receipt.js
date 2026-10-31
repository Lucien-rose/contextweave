import { getMemory } from "../database.js";

const detailLimit = 24;
const privacyReasons = new Set(["egress-policy-gate", "audience-context-gate", "intimacy-mode-gate",
  "policy-scope-gate", "scene-only-policy", "private-technical-weak-only"]);

export function buildReceiptDetails(db, recalled, { query, hostStatus, latencyMs }) {
  const trace = recalled.trace;
  const selected = [...recalled.memories, ...(recalled.background_memories || [])];
  const items = selected.map(memory => ({
    memory_id: memory.id, content_hash: memory.content_hash, title: memory.title,
    tier: memory.recall_tier, result: "prepared",
    detail_level: memory.detail_level,
  }));
  const counts = { filtered: 0, privacy_blocked: 0 };
  for (const candidate of trace.candidates) {
    if (candidate.final || !candidate.candidate_generated) continue;
    const result = privacyReasons.has(candidate.reason) ? "privacy_blocked" : "filtered";
    counts[result] += 1;
    if (counts[result] > detailLimit) continue;
    const memory = getMemory(db, candidate.id);
    if (!memory) continue;
    items.push({ memory_id: memory.id, content_hash: memory.content_hash, title: memory.title,
      tier: candidate.recall_tier || null, result,
      reason: candidate.packing_decision?.startsWith("skipped") || candidate.packing_decision === "total-budget-or-duplicate"
        ? candidate.packing_decision : candidate.reason });
  }
  return { schema_version: 1, query, latency_ms: Math.round(latencyMs * 100) / 100,
    package_characters: selected.length ? JSON.stringify(selected).length : 0, memory_package_tokens: null,
    routes: { fts: Boolean(trace.fts_shadow?.query_count),
      vector: Boolean(trace.vector?.query_count), jev: ["applied", "partial", "observed"].includes(hostStatus?.jev_status),
      fallback: Boolean(hostStatus?.fallback_used || trace.vector?.degraded) },
    items, counts };
}

export function readRecallReceipt(db, receiptId) {
  const row = db.prepare("SELECT * FROM recall_deliveries WHERE id = ?").get(receiptId);
  if (!row) return null;
  const details = row.details_json ? JSON.parse(row.details_json) : { schema_version: 1, items:
    JSON.parse(row.selected_json).map(item => ({ memory_id: item.id, content_hash: item.hash,
      title: null, tier: null, result: "prepared" })) };
  const delivered = row.delivered_ids_json ? new Set(JSON.parse(row.delivered_ids_json)) : null;
  const empty = !JSON.parse(row.selected_json).length;
  return { ...details, receipt_id: row.id, created_at: row.created_at,
    status: empty ? "empty" : row.delivered_at ? "delivered" : "prepared",
    items: details.items.map(item => item.result !== "prepared" ? item : { ...item,
      result: delivered ? delivered.has(item.memory_id) ? "delivered" : "not_delivered" : "prepared" }) };
}
