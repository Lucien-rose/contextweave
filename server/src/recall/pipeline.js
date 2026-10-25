import { defaults } from "../defaults.js";
import { selectRecallCandidates } from "./selection.js";
import { buildRecallResult, buildSuppressedRecallResult } from "./result.js";
import { prepareQueryContext, queryContextTrace } from "./query-representation.js";
import { observeCueNeighborhood } from "./cue-neighborhood.js";
import { normalizeRecallControl } from "./control.js";
import { calculateContextualRelevanceFloor, calculateRelativeRelevanceFloor, compareMemoryIds, compareScored,
  rankWithHybridEvidence, recentSets, selectSituationActivationCandidates } from "./ranking.js";
import { contextualEvidenceHardeningEnabled, ftsShadowEnabled, relativeTailFilterEnabled, resolveSituationMode } from "./runtime.js";
import { evaluateCandidates } from "./evaluate.js";
export function recallMemories(repository, {
  query,
  context = "general",
  intimacyMode = "off",
  limit = defaults.recallItems,
  includeArchived = true,
  recentlyReadIds = [],
  recentlyReadHashes = [],
  recentlyReadFamilies = [],
  familyPolicy = "representative",
  allowRepeat = false,
  allowRepeatIfStale = false,
  contextEnvelope = null,
  queryRepresentation = null,
  backgroundLimit = defaults.backgroundItems,
  backgroundBudgetChars = defaults.backgroundChars,
  cueNeighborhoodMode = "observe",
  recallControl = null,
  vectorRecall = null,
  associationRecall = null,
  contextBudgetChars = defaults.mainChars,
  totalBudgetChars,
  allowedMemoryIds = null,
  at = new Date(),
} = {}) {
  const result = recallMemoriesWithTrace(repository, {
    query,
    context,
    intimacyMode,
    limit,
    includeArchived,
    recentlyReadIds,
    recentlyReadHashes,
    recentlyReadFamilies,
    familyPolicy,
    allowRepeat,
    allowRepeatIfStale,
    contextEnvelope, queryRepresentation, backgroundLimit, backgroundBudgetChars, cueNeighborhoodMode,
    recallControl,
    vectorRecall,
    associationRecall,
    contextBudgetChars,
    totalBudgetChars,
    allowedMemoryIds,
    at,
  });
  return [...result.memories, ...result.background_memories];
}

export function recallMemoriesWithTrace(repository, {
  query,
  context = "general",
  intimacyMode = "off",
  limit = defaults.recallItems,
  includeArchived = true,
  recentlyReadIds = [],
  recentlyReadHashes = [],
  recentlyReadFamilies = [],
  familyPolicy = "representative",
  allowRepeat = false,
  allowRepeatIfStale = false,
  contextEnvelope = null,
  queryRepresentation = null,
  backgroundLimit = defaults.backgroundItems,
  backgroundBudgetChars = defaults.backgroundChars,
  cueNeighborhoodMode = "observe",
  recallControl = null,
  vectorRecall = null,
  associationRecall = null,
  contextBudgetChars = defaults.mainChars,
  totalBudgetChars,
  allowedMemoryIds = null,
  recordRecall = true,
  preparedQuery = null,
  captureCandidates = null,
  shadowMode = "default",
  at = new Date(),
} = {}) {
  const startedAt = process.hrtime.bigint();
  const phases = {};
  let phaseStart = performance.now();
  const markPhase = (name) => {
    const now = performance.now();
    phases[name] = Math.round((now - phaseStart) * 100) / 100;
    phaseStart = now;
  };
  const control = normalizeRecallControl(recallControl);
  if (control.suppressAll) {
    return buildSuppressedRecallResult({
      startedAt, query, context, intimacyMode, contextEnvelope, shadowMode, control,
    });
  }
  repository.beginRead();
  const queryContext = preparedQuery || prepareQueryContext(query, queryRepresentation, contextEnvelope);
  const recent = recentSets(recentlyReadIds, recentlyReadHashes, recentlyReadFamilies);
  const runtime = prepareRecallRuntime(repository, {
    query, context, intimacyMode, queryContext, shadowMode, control, vectorRecall, associationRecall, allowedMemoryIds, captureCandidates,
  });
  markPhase("candidate_preparation");
  let { scored, traceCandidates, observed } = evaluateCandidates(runtime, {
    query, context, intimacyMode, includeArchived, allowRepeat, allowRepeatIfStale, recent, captureCandidates: Boolean(captureCandidates),
  });
  if (captureCandidates) captureCandidates({ runtime, entries: observed });

  markPhase("candidate_scoring");
  const contextualTail = applyContextualTail(scored, traceCandidates);
  scored = contextualTail.scored;
  const contextualRelevanceFloor = contextualTail.floor;
  const relativeTail = applyRelativeTail(scored, traceCandidates);
  scored = relativeTail.scored;
  const relativeRelevanceFloor = relativeTail.floor;
  scored.sort(compareScored);
  scored = applySituationRanking(scored, traceCandidates, runtime);
  const { memories, backgroundMemories, selected, budget, background, verifyPlan } = selectRecallCandidates(repository,
    scored, traceCandidates, runtime, { query, context, intimacyMode, familyPolicy, limit,
      contextBudgetChars, backgroundLimit, backgroundBudgetChars, totalBudgetChars });
  markPhase("authority_ranking");
  if (recordRecall) repository.markRecalled(selected.map(({ memory }) => memory.id));

  const result = buildRecallResult({
    startedAt, query, context, intimacyMode, recordRecall, budget,
    contextualRelevanceFloor, relativeRelevanceFloor, verifyPlan,
    memories, traceCandidates, ...runtime,
  });
  markPhase("presentation_packing");
  result.background_memories = backgroundMemories;
  result.trace.main_final_ids = memories.map((memory) => memory.id);
  result.trace.final_ids = [...memories, ...backgroundMemories].map((memory) => memory.id);
  result.trace.counts.final = result.trace.final_ids.length;
  if (!memories.length && backgroundMemories.length) result.trace.route = "AMBIENT";
  result.trace.background_budget = { char_budget: background.charBudget, selected_chars: background.selectedChars,
    max_items: background.maxItems, selected_ids: backgroundMemories.map((memory) => memory.id) };
  result.trace.query_representation = queryContextTrace(queryContext);
  result.trace.cue_neighborhood = observeCueNeighborhood(runtime, traceCandidates, query, { mode: cueNeighborhoodMode });
  result.trace.pipeline_phases_ms = phases;
  result.trace.latency_ms = Math.round(Number(process.hrtime.bigint() - startedAt) / 10000) / 100;
  return result;
}

function prepareRecallRuntime(repository, {
  query, context, intimacyMode, queryContext, shadowMode, control, vectorRecall = null, associationRecall = null, allowedMemoryIds = null, captureCandidates = null,
}) {
  const { recallPlan, envelope, queryFocus, technicalIntent } = queryContext;
  const allowedIds = normalizeAllowedMemoryIds(allowedMemoryIds);
  const loaded = recallPlan.candidate_statuses
    .flatMap((status) => repository.list(status))
    .filter((memory) => !allowedIds || allowedIds.has(memory.id))
    .sort(compareMemoryIds);
  const loadedById = new Map(loaded.map((memory) => [memory.id, memory]));
  const historicalReferences = recallPlan.historical_reference
    ? recallPlan.candidate_statuses.includes("superseded")
      ? loaded.filter((memory) => memory.status === "superseded")
      : repository.list("superseded").filter((memory) => !allowedIds || allowedIds.has(memory.id))
    : [];
  const historicalFamilyKeys = new Set(historicalReferences.map((memory) => memory.family_key));
  const currentStateRoute = recallPlan.state_scope === "current";
  const shadowEnabled = currentStateRoute && ftsShadowEnabled(shadowMode);
  const ftsShadow = shadowEnabled
    ? repository.search([query, envelope.hypotheses])
    : {
        items: [], query_count: 0, term_count: 0, degraded: false,
        reason: currentStateRoute ? "disabled-by-flag" : "historical-route-canonical-scan",
      };
  const ftsShadowRanks = new Map(ftsShadow.items.map((item) => [item.id, item.rank]));
  const situationMode = resolveSituationMode(shadowMode);
  const situationEnabled = currentStateRoute && situationMode !== "off" && !control.suppressSituation;
  const situationShadow = situationEnabled
    ? repository.situation({ query, context: envelope.hypotheses, envelope })
    : {
        items: [], query_count: 0, concept_count: 0, blocked: false,
        degraded: false, reason: !currentStateRoute
          ? "historical-route-canonical-scan"
          : control.suppressSituation
          ? "suppressed-by-recall-control"
          : "disabled-by-flag",
      };
  const observationSituation = captureCandidates && situationEnabled && situationShadow.blocked
    ? repository.situation({ query, context: envelope.hypotheses, envelope }, { ignoreSemanticGuard: true })
    : situationShadow;
  const observationSituationIds = new Set(observationSituation.items.map((item) => item.id));
  const situationShadowById = new Map(situationShadow.items.map((item) => [item.id, item]));
  const situationActivationDecisions = !situationShadow.degraded && !situationShadow.blocked
    ? selectSituationActivationCandidates(situationShadow.items)
    : new Map();
  const situationActivationEnabled = situationEnabled
    && situationMode === "on"
    && !situationShadow.degraded
    && !situationShadow.blocked;
  const situationAdmissionActivationIds = new Set(situationActivationEnabled
    ? [...situationActivationDecisions.entries()]
      .filter(([, decision]) => decision.eligible)
      .map(([id]) => id)
    : []);
  const situationTailActivationIds = new Set(situationActivationEnabled
    ? [...situationActivationDecisions.entries()]
      .filter(([, decision]) => decision.tailEligible)
      .map(([id]) => id)
    : []);
  const vectorResult = vectorRecall || {
    enabled: false, degraded: false, reason: "not-requested", mode: "off", backend: "qdrant",
    items: [], query_count: 0, candidate_count: 0, qualified_count: 0, indexed_count: 0,
    eligible_count: 0, pending_count: 0, indexed_now: 0,
  };
  const vectorById = new Map((vectorResult.items || []).map((item) => [item.id, item]));
  const vectorActivationEnabled = vectorResult.mode === "on" && vectorResult.enabled && !vectorResult.degraded;
  const associationResult = associationRecall || {
    enabled: false, degraded: false, reason: "not-requested", mode: "off",
    items: [], query_count: 0, candidate_count: 0, qualified_count: 0,
  };
  const associationById = new Map((associationResult.items || []).map((item) => [item.id, item]));
  const associationActivationEnabled = associationResult.mode === "on"
    && associationResult.enabled && !associationResult.degraded;
  return {
    repository, control, context, intimacyMode, queryContext, recallPlan, historicalFamilyKeys, loaded, loadedById, envelope, queryFocus, technicalIntent,
    observationSituationIds, observationGuardReason: situationShadow.blocked ? situationShadow.reason : null,
    entityMatches: repository.entities([query, ...(queryContext.facets?.entities || []), ...(queryContext.facets?.aliases || [])].join(" "), { context, intimacyMode, namespace: queryContext.contextEnvelope?.entity_namespace }),
    shadowEnabled, ftsShadow, ftsShadowRanks,
    situationMode, situationEnabled, situationShadow, situationShadowById,
    situationActivationDecisions, situationActivationEnabled,
    situationAdmissionActivationIds, situationTailActivationIds,
    vectorResult, vectorById, vectorActivationEnabled,
    associationResult, associationById, associationActivationEnabled,
  };
}



function normalizeAllowedMemoryIds(value) {
  if (value == null) return null;
  const ids = Array.isArray(value) ? value : value instanceof Set ? [...value] : [];
  return new Set(ids.map((id) => String(id || "").trim()).filter(Boolean));
}

function applyContextualTail(scored, traceCandidates) {
  if (!contextualEvidenceHardeningEnabled() || !scored.some((entry) => entry.contextualMatch)) {
    return { scored, floor: null };
  }
  const floor = calculateContextualRelevanceFloor(scored);
  const traceById = new Map(traceCandidates.map((candidate) => [candidate.id, candidate]));
  return {
    floor,
    scored: scored.filter((entry) => {
      if (entry.situationEvidence
        || entry.vectorEvidence
        || entry.associationEvidence
        || !entry.contextualMatch
        || entry.rawDirectEvidence
        || entry.discoveryScore >= floor) {
        return true;
      }
      const candidate = traceById.get(entry.memory.id);
      if (candidate) {
        candidate.admission = "suppress";
        candidate.reason = "contextual-relative-tail";
        candidate.contextual_relevance_floor = floor;
      }
      return false;
    }),
  };
}

function applyRelativeTail(scored, traceCandidates) {
  if (!relativeTailFilterEnabled() || scored.length <= 1) return { scored, floor: null };
  const floor = calculateRelativeRelevanceFloor(scored);
  const traceById = new Map(traceCandidates.map((candidate) => [candidate.id, candidate]));
  return {
    floor,
    scored: scored.filter((entry) => {
      if (entry.situationEvidence || entry.vectorEvidence || entry.associationEvidence
        || entry.directEvidence || entry.discoveryScore >= floor) return true;
      const candidate = traceById.get(entry.memory.id);
      if (candidate) {
        candidate.admission = "suppress";
        candidate.reason = "weak-relative-tail";
        candidate.relative_relevance_floor = floor;
      }
      return false;
    }),
  };
}

function applySituationRanking(scored, traceCandidates, runtime) {
  if (!runtime.situationActivationEnabled && !runtime.vectorActivationEnabled) return scored;
  const ranked = rankWithHybridEvidence(scored, runtime.situationShadowById, runtime.vectorById);
  const traceById = new Map(traceCandidates.map((candidate) => [candidate.id, candidate]));
  for (const entry of ranked) {
    const candidate = traceById.get(entry.memory.id);
    if (!candidate) continue;
    candidate.situation_activated = Boolean(entry.situationEvidence);
    candidate.vector_activated = Boolean(entry.vectorEvidence);
    candidate.formal_position_before_activation = entry.formalPositionBeforeActivation || null;
    candidate.activation_hybrid_score = entry.activationHybridScore || 0;
  }
  return ranked;
}

