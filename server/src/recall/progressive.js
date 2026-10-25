import { recallMemoriesWithTrace } from "./pipeline.js";
import { prepareQueryContext } from "./query-representation.js";
import { associationSeedIds } from "./tiering.js";
import { hasAssociationRoom } from "./packing.js";

export async function progressiveRecall(repository, {
  vectorMode = null, recordRecall = true, syncIndex = true,
  allowedMemoryIds = null, vectorSyncBatchSize = null, ...input
} = {}, vectors = { primary: async () => ({ enabled: false, mode: "off", reason: "not-configured" }) }) {
  const start = performance.now();
  const phases = {};
  const runFinal = (options, passes) => {
    const finalStart = performance.now();
    const result = recallMemoriesWithTrace(repository, { ...input, ...options, recordRecall, allowedMemoryIds });
    phases.final_pipeline = performance.now() - finalStart;
    result.trace.request_latency_ms = rounded(performance.now() - start);
    result.trace.request_phases_ms = Object.fromEntries(Object.entries(phases).map(([key, ms]) => [key, rounded(ms)]));
    result.trace.pipeline_passes = passes;
    return result;
  };
  if (input.recallControl?.mode === "no_recall") return runFinal({}, 1);
  const preparedQuery = prepareQueryContext(input.query, input.queryRepresentation, input.contextEnvelope);
  phases.query_preparation = performance.now() - start;
  const vectorStart = performance.now();
  const vectorRecall = await vectors.primary({
    query: input.query, contextEnvelope: input.contextEnvelope, preparedQuery,
    mode: vectorMode || undefined, syncIndex, ensureStore: syncIndex,
    allowedMemoryIds, syncBatchSize: vectorSyncBatchSize,
  });
  phases.vector = performance.now() - vectorStart;
  // No seed pass is needed when the primary vector route cannot expand.
  if (!vectorRecall.enabled || vectorRecall.degraded || vectorRecall.mode === "off") {
    return runFinal({ preparedQuery, vectorRecall,
      associationRecall: unavailableAssociation(vectorRecall, vectorRecall.reason || "primary-vector-unavailable") }, 1);
  }
  const seedStart = performance.now();
  const seedPass = recallMemoriesWithTrace(repository, {
    ...input, preparedQuery, vectorRecall, allowedMemoryIds,
    limit: Math.min(12, Math.max(Number(input.limit) || 5, 8)), recordRecall: false, captureCandidates: null,
  });
  phases.seed_pipeline = performance.now() - seedStart;
  const seedIds = associationSeedIds(seedPass.memories);
  const blockedReason = !seedIds.length ? "no-qualified-seeds"
    : hasAssociationRoom(seedPass, input) ? null : "direct-evidence-budget-exhausted";
  const associationStart = performance.now();
  const associationRecall = blockedReason ? unavailableAssociation(vectorRecall, blockedReason)
    : await vectors.association({
      seedIds, mode: vectorMode || vectorRecall.mode, allowedMemoryIds,
    });
  phases.association = performance.now() - associationStart;
  return runFinal({ preparedQuery, vectorRecall, associationRecall }, 2);
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function unavailableAssociation(vectorRecall, reason) {
  const mode = vectorRecall?.mode || "off";
  return { enabled: mode !== "off", degraded: Boolean(vectorRecall?.degraded), reason, mode,
    query_count: 0, candidate_count: 0, qualified_count: 0, items: [] };
}
