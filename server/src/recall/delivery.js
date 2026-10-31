import { scopedRecallInput, recordSurfaceDelivery } from "./cooldown.js";
import { updateCharacterCount } from "./response-budget.js";
import { randomUUID } from "node:crypto";
import { getMemory } from "../database.js";
import { recallMemoriesWithTrace, progressiveRecall } from "./sqlite.js";
import { buildHomecomingBundle, memoriesForDate } from "../retrieval.js";
import { buildReceiptDetails } from "./receipt.js";

// Keep legacy clients working. Confirmed delivery is an explicit host contract:
// the host acknowledges only the items that reached the model's context.
export function recallForDelivery(db, input = {}) {
  const started = performance.now();
  const { deliveryMode = "immediate", ...recallInput } = scopedRecallInput(db, input);
  if (!["immediate", "confirmed"].includes(deliveryMode)) throw new TypeError("Invalid delivery mode");
  const recalled = recallMemoriesWithTrace(db, {
    ...recallInput,
    recordRecall: deliveryMode === "immediate",
  });
  return attachDelivery(db, recalled, [...recalled.memories, ...(recalled.background_memories || [])], deliveryMode, recallInput.recallScope,
    buildReceiptDetails(db, recalled, { query: input.query, latencyMs: performance.now() - started }));
}

export async function recallForDeliveryWithVector(db, input = {}) {
  const started = performance.now();
  let hostStatus;
  const { deliveryMode = "immediate", vectorMode = null, ...recallInput } = scopedRecallInput(db, input);
  if (!["immediate", "confirmed"].includes(deliveryMode)) throw new TypeError("Invalid delivery mode");
  const recalled = await progressiveRecall(db, {
    ...recallInput,
    vectorMode,
    recordRecall: deliveryMode === "immediate",
    syncIndex: true,
    onRecallStatus(status) { hostStatus = status; input.onRecallStatus?.(status); },
  });
  return attachDelivery(db, recalled, [...recalled.memories, ...(recalled.background_memories || [])], deliveryMode, recallInput.recallScope,
    buildReceiptDetails(db, recalled, { query: input.query, hostStatus, latencyMs: performance.now() - started }));
}

export function bootstrapForDelivery(db, { deliveryMode = "immediate", ...input } = {}) {
  validateDeliveryMode(deliveryMode);
  const bundle = buildHomecomingBundle(db, { ...input, recordRecall: deliveryMode === "immediate" });
  const items = bundle.schema_version === 3 ? [...bundle.continuity_seed, ...bundle.observances]
    : [...bundle.deep_reads.general, ...bundle.deep_reads.intimate,
      ...bundle.working_summaries, ...bundle.agreement_manifest, ...bundle.observances];
  return attachDelivery(db, bundle, items, deliveryMode);
}

export function todayForDelivery(db, { deliveryMode = "immediate", ...input } = {}) {
  validateDeliveryMode(deliveryMode);
  const memories = memoriesForDate(db, { ...input, recordRecall: deliveryMode === "immediate" });
  return attachDelivery(db, { memories }, memories, deliveryMode);
}

function validateDeliveryMode(mode) {
  if (!["immediate", "confirmed"].includes(mode)) throw new TypeError("Invalid delivery mode");
}

function attachDelivery(db, payload, memories, deliveryMode, scope = null, details = null) {
  if (!details && (deliveryMode === "immediate" || !memories.length)) return payload;
  const id = `delivery:${randomUUID()}`;
  const selected = [...new Map(memories.map((memory) => [memory.id,
    { id: memory.id, hash: memory.content_hash, lane: payload.memories?.some(item => item.id === memory.id) ? "main" : "background" }])).values()];
  const createdAt = new Date().toISOString();
  const finalized = deliveryMode === "immediate" || !memories.length;
  db.prepare(`INSERT INTO recall_deliveries(id, selected_json, created_at, scope_json, details_json, delivered_at, delivered_ids_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, JSON.stringify(selected), createdAt, scope ? JSON.stringify(scope) : null,
      details ? JSON.stringify(details) : null, finalized ? createdAt : null,
      finalized ? JSON.stringify(selected.map(item => item.id).sort()) : null);
  const receipt = { receipt_id: id, status: !memories.length ? "empty" : finalized ? "delivered" : "prepared" };
  const response = { ...payload, ...(details ? { receipt } : {}),
    ...(!finalized ? { delivery: { receipt_id: id, status: "prepared" } } : {}) };
  if (response.budgets) updateCharacterCount(response);
  return response;
}

export function acknowledgeRecallDelivery(db, { receiptId, memoryIds, memoryPackageTokens } = {}) {
  if (memoryPackageTokens != null && (!Number.isSafeInteger(memoryPackageTokens) || memoryPackageTokens < 0)) {
    throw new TypeError("memory_package_tokens must be a non-negative integer");
  }
  if (typeof receiptId !== "string" || !receiptId.startsWith("delivery:")) {
    throw new TypeError("Valid receipt_id is required");
  }
  if (!Array.isArray(memoryIds) || !memoryIds.length || memoryIds.length > 64
    || memoryIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new TypeError("memory_ids must contain 1 to 64 delivered IDs");
  }
  const ids = [...new Set(memoryIds)].sort();
  db.exec("BEGIN IMMEDIATE");
  try {
    const receipt = db.prepare("SELECT * FROM recall_deliveries WHERE id = ?").get(receiptId);
    if (!receipt) throw Object.assign(new TypeError("Delivery receipt is no longer available"), { status: 410 });
    const selected = JSON.parse(receipt.selected_json);
    if (ids.some((id) => !selected.some((item) => item.id === id))) {
      throw new TypeError("Delivered IDs must belong to this receipt");
    }
    if (receipt.delivered_at) {
      if (JSON.stringify(ids) !== receipt.delivered_ids_json) {
        throw new TypeError("Delivery was already acknowledged with different IDs");
      }
      db.exec("COMMIT");
      return { status: "delivered", duplicate: true, recorded_count: 0 };
    }
    // A revised body must not inherit the read count of the previous body.
    const unchanged = ids.filter((id) => {
      const memory = getMemory(db, id);
      return memory && memory.content_hash === selected.find((item) => item.id === id).hash;
    });
    const deliveredAt = new Date().toISOString();
    if (memoryPackageTokens != null && receipt.details_json) {
      const details = JSON.parse(receipt.details_json);
      details.memory_package_tokens = memoryPackageTokens;
      db.prepare("UPDATE recall_deliveries SET details_json = ? WHERE id = ?").run(JSON.stringify(details), receiptId);
    }
    const mark = db.prepare(`UPDATE memories SET last_recalled_at = ?, recall_count = recall_count + 1 WHERE id = ?`);
    for (const id of unchanged) mark.run(deliveredAt, id);
    recordSurfaceDelivery(db, receipt.scope_json ? JSON.parse(receipt.scope_json) : null,
      selected.filter(item => unchanged.includes(item.id)), deliveredAt);
    db.prepare(`UPDATE recall_deliveries SET delivered_ids_json = ?, delivered_at = ? WHERE id = ?`)
      .run(JSON.stringify(ids), deliveredAt, receiptId);
    db.exec("COMMIT");
    return { status: "delivered", duplicate: false, recorded_count: unchanged.length };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// Explicit maintenance only. Pending receipts have a longer retry window;
// no memory bodies or read counts are changed by this operation.
export function pruneRecallDeliveries(db, { at = new Date(), apply = false } = {}) {
  const cutoff = (days) => new Date(at.getTime() - days * 86_400_000).toISOString();
  const predicate = `(delivered_at IS NOT NULL AND delivered_at < ?)
    OR (delivered_at IS NULL AND created_at < ?)`;
  const cutoffs = [cutoff(30), cutoff(90)];
  const count = Number(db.prepare(`SELECT COUNT(*) AS count FROM recall_deliveries WHERE ${predicate}`).get(...cutoffs).count);
  if (apply) db.prepare("DELETE FROM recall_surface_deliveries WHERE delivered_at < ?").run(cutoff(30));
  const removed = apply ? Number(db.prepare(`DELETE FROM recall_deliveries WHERE ${predicate}`).run(...cutoffs).changes) : 0;
  return { mode: apply ? "applied" : "dry-run", eligible: count, removed,
    delivered_retention_days: 30, pending_retention_days: 90 };
}
