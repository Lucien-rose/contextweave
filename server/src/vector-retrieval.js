import { clampInteger } from "./lib/number.js";
import { normalizeContextEnvelope } from "./recall/context.js";
import { analyzeRecallQuery } from "./recall/query-focus.js";
import { round } from "./recall/runtime.js";
import { createEmbeddings, vectorProviderConfig } from "./vector-provider.js";
import { vectorEnvValue } from "./vector-settings.js";
import {
  deleteQdrantCollection, ensureQdrantCollection, qdrantConfig, qdrantHealth, queryQdrant,
} from "./vector-store.js";
import {
  ensureVectorCoverageJobs, listVectorJobs,
  resetVectorState, vectorStateStats,
} from "./vector-state.js";

import { bodyPolicy, memoryVectorProjection } from "./vector-projection.js";
import { syncPendingVectors } from "./vector-sync.js";
import { getMemory } from "./database.js";
import { flushVectorDeletions } from "./evolution/vector-deletion.js";
export { memoryVectorDocuments, memoryVectorProjection } from "./vector-projection.js";

import { vectorIndexIdentity, PROJECTION_VERSION } from "./vector/identity.js";
export { vectorIndexIdentity } from "./vector/identity.js";
import { activeVectorIndex, vectorDeployment, vectorDeploymentStatus, loadVectorGeneration } from "./vector/deployment.js";
const DEFAULT_TOP_K = 24;
const DEFAULT_MIN_SIMILARITY = 0.32;
const DEFAULT_RELATIVE_RATIO = 0.78;
const DEFAULT_REQUEST_SYNC_BATCH = 4;

export async function prepareVectorRecall(db, {
  query,
  contextEnvelope = null,
  preparedQuery = null,
  mode = resolveVectorMode(),
  embedder = createEmbeddings,
  fetchImpl,
  syncIndex = true,
  ensureStore = syncIndex,
  allowedMemoryIds = null,
  syncBatchSize = null,
  index = null,
} = {}) {
  const deployment = vectorDeployment(db);
  if (!index && deployment?.mode === "forced" && deployment.candidate_identity) {
    const results = await Promise.all([deployment.active_identity, deployment.candidate_identity].map(identity =>
      prepareVectorRecall(db, { query, contextEnvelope, preparedQuery, mode, embedder, fetchImpl, syncIndex: false,
        ensureStore: false, allowedMemoryIds, index: loadVectorGeneration(db, identity) })));
    const merged = new Map();
    for (const result of results) for (const item of result.items.filter(item => item.qualified)) {
      const prior = merged.get(item.id) || { ...item, fusion: 0 };
      prior.fusion += 1 / (60 + item.rank); merged.set(item.id, prior);
    }
    const items = [...merged.values()].sort((a,b) => b.fusion-a.fusion).slice(0, DEFAULT_TOP_K)
      .map((item, rank) => ({ ...item, rank: rank+1, similarity: round(1 / Math.sqrt(rank+1)), qualified: true }));
    return { ...results[1], degraded: results.some(r => r.degraded), reason: "forced-migration-rank-fusion",
      query_count: results.reduce((n,r) => n+r.query_count,0), items, candidate_count: items.length,
      qualified_count: items.length, generations: results.map(({model,degraded,reason}) => ({model,degraded,reason})) };
  }
  const effectiveMode = normalizeMode(mode);
  const { provider, identity, store } = index || activeVectorIndex(db);
  if (effectiveMode === "off") return disabledVectorResult("disabled-by-mode", effectiveMode, provider, store);
  if (!String(query || "").trim()) return disabledVectorResult("empty-query", effectiveMode, provider, store);
  if (!provider.available) return disabledVectorResult("missing-api-key", effectiveMode, provider, store, true);

  const phases = {};
  let phaseStart = performance.now();
  let synced = 0;
  let syncError = null;
  try {
    if (syncIndex) ensureVectorCoverageJobs(db, identity);
    const pending = syncIndex && listVectorJobs(db, 1, allowedMemoryIds, identity).length > 0;
    // An up-to-date index needs only the query request. Collection creation and
    // indexing stay on the pending-work path (or an explicit ensure request).
    if (ensureStore && (!syncIndex || pending)) await ensureQdrantCollection(store, { fetchImpl });
    if (pending) {
      try {
        const batch = await syncPendingVectors(db, {
          provider, identity, store, embedder, fetchImpl,
          memoryIds: allowedMemoryIds,
          limit: clampInteger(
            syncBatchSize ?? vectorEnvValue("MOSS_VECTOR_REQUEST_SYNC_BATCH", DEFAULT_REQUEST_SYNC_BATCH),
            1, 32, DEFAULT_REQUEST_SYNC_BATCH,
          ),
        });
        synced = batch.indexed;
      } catch (error) {
        // A failed refresh should not disable queries against the existing index.
        syncError = error?.code || "sync-failed";
      }
    }
    phases.index_sync = Math.round((performance.now() - phaseStart) * 100) / 100;
    phaseStart = performance.now();
    const envelope = preparedQuery?.envelope || normalizeContextEnvelope(contextEnvelope);
    const [queryVector] = await embedder([vectorQueryText(query, envelope, preparedQuery?.queryFocus)], { config: provider, fetchImpl });
    phases.query_embedding = Math.round((performance.now() - phaseStart) * 100) / 100;
    phaseStart = performance.now();
    const topK = clampInteger(vectorEnvValue("MOSS_VECTOR_TOP_K", DEFAULT_TOP_K), 1, 100, DEFAULT_TOP_K);
    const rawItems = await queryQdrant(store, queryVector, {
      limit: Math.min(100, Math.max(topK, topK * 4)),
      fetchImpl,
      memoryIds: allowedMemoryIds,
    });
    phases.qdrant = Math.round((performance.now() - phaseStart) * 100) / 100;
    const freshItems = rawItems.filter(item => db.prepare(
      "SELECT 1 FROM memory_vector_state WHERE memory_id=? AND index_identity=?").get(item.id, identity));
    const items = collapseVectorChunks(deployment ? freshItems : rawItems, topK);
    const qualified = qualifyVectorItems(items);
    const stats = vectorStateStats(db, identity, allowedMemoryIds);
    return { ...vectorResult({
      mode: effectiveMode, provider, store, identity, stats, synced, items: qualified, syncError,
    }), phases_ms: phases };
  } catch (error) {
    const stats = vectorStateStats(db, identity, allowedMemoryIds);
    return {
      ...disabledVectorResult(error?.code || "vector-error", effectiveMode, provider, store, true),
      phases_ms: phases,
      indexed_count: stats.indexed,
      eligible_count: stats.eligible,
      pending_count: stats.pending,
      indexed_now: synced,
    };
  }
}


export async function prepareAssociativeVectorRecall(db, {
  seedIds = [],
  mode = resolveVectorMode(),
  embedder = createEmbeddings,
  fetchImpl,
  maxSeeds = 4,
  topK = 8,
  allowedMemoryIds = null,
} = {}) {
  const effectiveMode = normalizeMode(mode);
  const { provider, identity, store } = activeVectorIndex(db);
  const seeds = [...new Set(seedIds)].slice(0, clampInteger(maxSeeds, 1, 8, 4))
    .map((id) => getMemory(db, id))
    .filter((memory) => memory?.status === "active")
    .map((memory) => ({ memory, text: memoryVectorProjection(memory).slice(0, 6000) }))
    .filter((item) => item.text.trim());
  if (effectiveMode === "off") return disabledAssociationResult("disabled-by-mode", effectiveMode);
  if (!seeds.length) return disabledAssociationResult("no-qualified-seeds", effectiveMode);
  if (!provider.available) return disabledAssociationResult("missing-api-key", effectiveMode, true);

  try {
    const embeddingStart = performance.now();
    const vectors = await embedder(seeds.map((seed) => seed.text), { config: provider, fetchImpl });
    const embeddingMs = performance.now() - embeddingStart;
    const qdrantStart = performance.now();
    const perSeedLimit = clampInteger(topK, 1, 24, 8);
    const seedIdsSet = new Set(seeds.map((seed) => seed.memory.id));
    const batches = await Promise.all(seeds.map(async (seed, index) => {
      const raw = await queryQdrant(store, vectors[index], {
        limit: Math.min(100, perSeedLimit * 4), fetchImpl, memoryIds: allowedMemoryIds,
      });
      // Seed self-matches must not set the relative threshold for their neighbours.
      const neighbours = raw.filter((item) => !seedIdsSet.has(item.id) && (!vectorDeployment(db) || db.prepare(
        "SELECT 1 FROM memory_vector_state WHERE memory_id=? AND index_identity=?").get(item.id, identity)));
      const qualified = qualifyVectorItems(collapseVectorChunks(neighbours, perSeedLimit));
      return qualified.map((item) => ({ ...item, seed_id: seed.memory.id }));
    }));
    const items = mergeAssociativeCandidates(batches.flat(), perSeedLimit * 2);
    return {
      phases_ms: { seed_embedding: Math.round(embeddingMs * 100) / 100,
        qdrant: Math.round((performance.now() - qdrantStart) * 100) / 100 },
      enabled: true,
      degraded: false,
      reason: null,
      mode: effectiveMode,
      query_count: seeds.length,
      candidate_count: items.length,
      qualified_count: items.filter((item) => item.qualified).length,
      items,
    };
  } catch (error) {
    return disabledAssociationResult(error?.code || "association-vector-error", effectiveMode, true);
  }
}

export async function rebuildVectorIndex(db, {
  embedder = createEmbeddings,
  fetchImpl,
  batchSize = 32,
  recreate = true,
} = {}) {
  if (vectorDeployment(db)) throw new Error("Use blue/green sync instead of destructive rebuild while generations are managed");
  const provider = vectorProviderConfig();
  if (!provider.available) throw Object.assign(new Error("Embedding provider unavailable"), { code: "missing-api-key" });
  const identity = vectorIndexIdentity(provider);
  const store = qdrantConfig({ indexIdentity: identity, dimensions: provider.dimensions });
  if (recreate) await deleteQdrantCollection(store, { fetchImpl });
  await ensureQdrantCollection(store, { fetchImpl });
  resetVectorState(db, identity);
  ensureVectorCoverageJobs(db, identity);
  let total = 0;
  for (;;) {
    const batch = await syncPendingVectors(db, {
      provider, identity, store, embedder, fetchImpl,
      limit: Math.max(1, Math.min(256, Number(batchSize) || 32)),
    });
    total += batch.indexed;
    if (!batch.processed) break;
  }
  return maintenanceResult(vectorStateStats(db, identity), {
    indexedNow: total, collection: store.collection, identity, batches: null,
  });
}

export async function syncVectorIndex(db, {
  embedder = createEmbeddings,
  fetchImpl,
  batchSize = 32,
  maxBatches = 16,
  index = null,
} = {}) {
  if (!index && vectorDeployment(db)) {
    const outcomes = [];
    for (const row of db.prepare("SELECT identity FROM vector_generations WHERE writable=1").all()) {
      try { outcomes.push({ identity: row.identity, ...await syncVectorIndex(db, {
        embedder, fetchImpl, batchSize, maxBatches, index: loadVectorGeneration(db, row.identity) }) }); }
      catch (error) { outcomes.push({ identity: row.identity, error: error.code || "sync-failed" }); }
    }
    return { generations: outcomes, ...vectorDeploymentStatus(db) };
  }
  await flushVectorDeletions(db, { fetchImpl });
  if (vectorDeployment(db)) db.exec("DELETE FROM memory_vector_jobs WHERE memory_id IN (SELECT id FROM memories WHERE status NOT IN ('active','superseded'))");
  const { provider, identity, store } = index || activeVectorIndex(db);
  if (!provider.available) throw Object.assign(new Error("Embedding provider unavailable"), { code: "missing-api-key" });
  await ensureQdrantCollection(store, { fetchImpl });
  ensureVectorCoverageJobs(db, identity);
  let indexedNow = 0;
  let batches = 0;
  while (batches < Math.max(1, Math.min(1000, Number(maxBatches) || 16))) {
    const batch = await syncPendingVectors(db, {
      provider, identity, store, embedder, fetchImpl,
      limit: Math.max(1, Math.min(256, Number(batchSize) || 32)),
    });
    if (!batch.processed) break;
    indexedNow += batch.indexed;
    batches += 1;
  }
  return maintenanceResult(vectorStateStats(db, identity), {
    indexedNow, collection: store.collection, identity, batches,
  });
}

export async function vectorRuntimeStatus(db, { probe = false, fetchImpl } = {}) {
  const { provider, identity, store } = activeVectorIndex(db);
  const stats = vectorStateStats(db, identity);
  return {
    migration: vectorDeploymentStatus(db),
    mode: resolveVectorMode(),
    backend: "qdrant",
    provider: provider.provider,
    model: provider.model,
    dimensions: provider.dimensions,
    provider_available: provider.available,
    body_policy: bodyPolicy(),
    projection_version: PROJECTION_VERSION,
    collection: store.collection,
    index_identity: identity,
    indexed_count: stats.indexed,
    eligible_count: stats.eligible,
    pending_count: stats.pending,
    ...(probe ? { qdrant: await qdrantHealth(store, { fetchImpl }) } : {}),
  };
}

export function vectorQueryText(query, envelope, focus = analyzeRecallQuery(query)) {
  const parts = focus.applied
    ? [`focus: ${focus.searchText}`, `context: ${focus.residualText}`]
    : [`query: ${String(query || "").trim()}`];
  for (const topic of envelope?.topics || []) parts.push(`topic: ${topic}`);
  for (const cue of envelope?.stateCues || []) parts.push(`context: ${cue}`);
  for (const hypothesis of envelope?.hypotheses || []) parts.push(`intent: ${hypothesis}`);
  return parts.join("\n");
}

export function resolveVectorMode(input = null) {
  if (input && ["off", "observe", "on"].includes(String(input))) return String(input);
  const configured = String(vectorEnvValue("MOSS_RECALL_VECTOR_MODE", "off")).toLowerCase();
  return ["off", "observe", "on"].includes(configured) ? configured : "off";
}


function collapseVectorChunks(items, limit) {
  const best = new Map();
  for (const item of items) {
    const previous = best.get(item.id);
    if (!previous || item.score > previous.score) best.set(item.id, item);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.rank - b.rank)
    .slice(0, limit)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function qualifyVectorItems(items) {
  if (!items.length) return [];
  const absolute = clampNumber(vectorEnvValue("MOSS_VECTOR_MIN_SIMILARITY", DEFAULT_MIN_SIMILARITY), 0, 1, DEFAULT_MIN_SIMILARITY);
  const ratio = clampNumber(vectorEnvValue("MOSS_VECTOR_RELATIVE_RATIO", DEFAULT_RELATIVE_RATIO), 0, 1, DEFAULT_RELATIVE_RATIO);
  const top = Math.max(0, Number(items[0]?.score) || 0);
  const threshold = Math.max(absolute, top * ratio);
  return items.map((item) => ({
    id: item.id,
    rank: item.rank,
    similarity: round(item.score),
    absolute_qualified: item.score >= absolute,
    absolute_threshold: absolute,
    qualified: item.score >= threshold,
    threshold: round(threshold),
    chunk_index: item.chunk_index,
    chunk_kind: item.chunk_kind,
  }));
}


function mergeAssociativeCandidates(items, limit) {
  const best = new Map();
  for (const item of items) {
    const previous = best.get(item.id);
    if (!previous
      || Number(item.similarity) > Number(previous.similarity)
      || (item.similarity === previous.similarity && item.rank < previous.rank)) best.set(item.id, item);
  }
  return [...best.values()]
    .sort((a, b) => Number(b.similarity) - Number(a.similarity) || a.rank - b.rank || compareText(a.id, b.id))
    .slice(0, Math.max(1, Number(limit) || 1))
    .map((item, index) => ({ ...item, association_rank: index + 1 }));
}

function disabledAssociationResult(reason, mode, degraded = false) {
  return {
    enabled: mode !== "off",
    degraded,
    reason,
    mode,
    query_count: 0,
    candidate_count: 0,
    qualified_count: 0,
    items: [],
  };
}

function compareText(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}

function maintenanceResult(stats, { indexedNow, collection, identity, batches }) {
  return {
    indexed_count: stats.indexed,
    pending_count: stats.pending,
    eligible_count: stats.eligible,
    indexed_now: indexedNow,
    ...(batches == null ? {} : { batches }),
    collection,
    index_identity: identity,
  };
}

function vectorResult({ mode, provider, store, identity, stats, synced, items, syncError }) {
  return {
    enabled: true,
    degraded: false,
    reason: null,
    mode,
    backend: "qdrant",
    provider: provider.provider,
    model: provider.model,
    dimensions: provider.dimensions,
    collection: store.collection,
    index_identity: identity,
    sync_error: syncError,
    query_count: 1,
    indexed_count: stats.indexed,
    eligible_count: stats.eligible,
    pending_count: stats.pending,
    indexed_now: synced,
    candidate_count: items.length,
    qualified_count: items.filter((item) => item.qualified).length,
    items,
  };
}

function disabledVectorResult(reason, mode, provider, store, degraded = false) {
  return {
    enabled: mode !== "off",
    degraded,
    reason,
    mode,
    backend: "qdrant",
    provider: provider.provider,
    model: provider.model,
    dimensions: provider.dimensions,
    collection: store.collection,
    index_identity: vectorIndexIdentity(provider),
    query_count: 0,
    indexed_count: 0,
    eligible_count: 0,
    pending_count: 0,
    indexed_now: 0,
    candidate_count: 0,
    qualified_count: 0,
    items: [],
  };
}

function normalizeMode(value) {
  return ["off", "observe", "on"].includes(String(value)) ? String(value) : resolveVectorMode();
}


function clampNumber(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}
