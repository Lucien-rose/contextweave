import { defaults } from "../defaults.js";
import { resolveSituationMode, round, relativeTailFilterEnabled, privateTechIsolationEnabled, contextualRecallEnabled, contextualEvidenceHardeningEnabled, lexicalEvidenceV2Enabled } from "./runtime.js";
import { resolveHistoricalRoute } from "./history-plan.js";
import { normalizeContextEnvelope } from "./context.js";
import { analyzeRecallQuery, queryFocusTrace } from "./query-focus.js";
import { isTechnicalTask } from "./admission.js";
import { CONTEXTUAL_TAIL_RATIO, SITUATION_ACTIVATION_CONFIDENCE_RATIO } from "./constants.js";
import { countRetrievalRoles, queryFingerprint } from "./trace.js";
import { recallRoute, resolveVerifyPlan, verificationResult } from "./verify-plan.js";
import { tierCounts } from "./tiering.js";
import { SITUATION_PROJECTION_GENERATION } from "./constants.js";

export function buildSuppressedRecallResult({
  startedAt, query, context, intimacyMode, contextEnvelope, shadowMode, control,
}) {
  const situationMode = resolveSituationMode(shadowMode);
  const recallPlan = resolveHistoricalRoute(query);
  return buildRecallResult({
    startedAt, query, context, intimacyMode, recordRecall: false,
    contextualRelevanceFloor: null, relativeRelevanceFloor: null,
    budget: { selectedChars: 0, charBudget: defaults.mainChars, maxItems: 0, skippedIds: [] },
    memories: [], traceCandidates: [], control, recallPlan, loaded: [], loadedById: new Map(),
    envelope: normalizeContextEnvelope(contextEnvelope),
    queryFocus: analyzeRecallQuery(query),
    technicalIntent: isTechnicalTask(query),
    shadowEnabled: false,
    ftsShadow: {
      items: [], query_count: 0, term_count: 0, degraded: false,
      reason: "suppressed-by-recall-control",
    },
    ftsShadowRanks: new Map(),
    situationMode, situationEnabled: false,
    situationShadow: {
      items: [], query_count: 0, concept_count: 0, blocked: false,
      degraded: false, reason: "suppressed-by-recall-control",
    },
    situationShadowById: new Map(),
    situationActivationEnabled: false,
    situationAdmissionActivationIds: new Set(),
    situationTailActivationIds: new Set(),
    vectorResult: { enabled: false, degraded: false, reason: "suppressed-by-recall-control", mode: "off", backend: "qdrant", items: [], query_count: 0, candidate_count: 0, qualified_count: 0, indexed_count: 0, eligible_count: 0, pending_count: 0, indexed_now: 0 },
    vectorById: new Map(),
    vectorActivationEnabled: false,
    associationResult: { enabled: false, degraded: false, reason: "suppressed-by-recall-control", mode: "off", items: [], query_count: 0, candidate_count: 0, qualified_count: 0 },
    associationById: new Map(),
    associationActivationEnabled: false,
    verifyPlan: resolveVerifyPlan(query),
  });
}

export function buildRecallResult({
  startedAt, query, context, intimacyMode, recordRecall,
  contextualRelevanceFloor, relativeRelevanceFloor, verifyPlan, budget,
  memories, traceCandidates,
  control, loaded, envelope, queryFocus, technicalIntent, shadowEnabled, ftsShadow, ftsShadowRanks,
  recallPlan,
  situationMode, situationEnabled, situationShadow, situationShadowById,
  situationActivationEnabled, situationAdmissionActivationIds, situationTailActivationIds,
  vectorResult, vectorById, vectorActivationEnabled,
  associationResult, associationById, associationActivationEnabled,
}) {
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const ftsFinalOverlap = memories.filter((memory) => ftsShadowRanks.has(memory.id)).length;
  const situationFinalOverlap = memories.filter((memory) => situationShadowById.has(memory.id)).length;
  const vectorFinalOverlap = memories.filter((memory) => vectorById.has(memory.id)).length;
  const associationFinalOverlap = memories.filter((memory) => associationById.has(memory.id)).length;
  const verification = verificationResult(verifyPlan, memories);
  return {
    memories,
    background_memories: [],
    verification,
    trace: {
      schema_version: 1,
      privacy_safe: true,
      query_fingerprint: queryFingerprint(query),
      context,
      intimacy_mode: intimacyMode,
      recall_control_mode: control.mode,
      recall_control_source: control.source,
      recall_control_scope: control.scope,
      route: recallRoute(memories, verifyPlan),
      verification_plan: verifyPlan,
      recall_plan: recallPlan,
      relative_tail_enabled: relativeTailFilterEnabled(),
      private_tech_isolation_enabled: privateTechIsolationEnabled(),
      contextual_recall_enabled: contextualRecallEnabled(),
      contextual_evidence_hardening_enabled: contextualEvidenceHardeningEnabled(),
      lexical_evidence_v2_enabled: lexicalEvidenceV2Enabled(),
      fts_shadow_enabled: shadowEnabled,
      situation_shadow_enabled: situationEnabled,
      situation_activation_enabled: situationActivationEnabled,
      situation_mode: situationMode,
      vector_enabled: Boolean(vectorResult?.enabled),
      vector_mode: vectorResult?.mode || "off",
      vector_activation_enabled: Boolean(vectorActivationEnabled),
      association_enabled: Boolean(associationResult?.enabled),
      association_mode: associationResult?.mode || "off",
      association_activation_enabled: Boolean(associationActivationEnabled),
      recall_recorded: Boolean(recordRecall),
      total_context_budget: { total_limit: budget.totalLimit || defaults.totalChars,
        selected_characters: budget.totalSelectedChars || 0 },
      contextual_tail_ratio: CONTEXTUAL_TAIL_RATIO,
      technical_intent: technicalIntent,
      query_focus: queryFocusTrace(queryFocus),
      context_envelope_present: envelope.present,
      context_hypothesis_count: envelope.hypothesisCount,
      context_descriptor_count: envelope.descriptorCount,
      contextual_relevance_floor: contextualRelevanceFloor,
      relative_relevance_floor: relativeRelevanceFloor,
      counts: {
        loaded_active: loaded.filter((memory) => memory.status === "active").length,
        loaded_candidates: loaded.length,
        loaded_by_status: Object.fromEntries(recallPlan.candidate_statuses.map((status) => [
          status, loaded.filter((memory) => memory.status === status).length,
        ])),
        admitted: traceCandidates.filter((item) => item.admission === "admit").length,
        suppressed: traceCandidates.filter((item) => item.admission === "suppress").length,
        rejected: traceCandidates.filter((item) => item.admission === "reject").length,
        final: memories.length,
      },
      retrieval_role_counts: countRetrievalRoles(loaded),
      recall_tier_counts: tierCounts(memories),
      context_budget: {
        char_budget: budget?.charBudget || 0,
        selected_chars: budget?.selectedChars || 0,
        max_items: budget?.maxItems || 0,
        skipped_count: budget?.skippedIds?.length || 0,
        protected_sidecar_id: budget?.protectedSidecarId || null,
        overflow_memory_id: budget?.overflowMemoryId || null,
      },
      fts_shadow: {
        enabled: shadowEnabled,
        degraded: ftsShadow.degraded,
        reason: ftsShadow.reason,
        query_count: ftsShadow.query_count,
        term_count: ftsShadow.term_count,
        candidate_count: ftsShadow.items.length,
        final_overlap_count: ftsFinalOverlap,
        final_overlap_ratio: memories.length ? round(ftsFinalOverlap / memories.length) : 0,
      },
      situation_shadow: {
        enabled: situationEnabled,
        mode: situationMode,
        activation_enabled: situationActivationEnabled,
        activation_confidence_ratio: SITUATION_ACTIVATION_CONFIDENCE_RATIO,
        activation_candidate_count: traceCandidates.filter((item) => item.situation_activated).length,
        activation_admission_eligible_count: situationAdmissionActivationIds.size,
        activation_tail_eligible_count: situationTailActivationIds.size,
        generation: SITUATION_PROJECTION_GENERATION,
        degraded: situationShadow.degraded,
        blocked: situationShadow.blocked,
        reason: situationShadow.reason,
        query_count: situationShadow.query_count,
        concept_count: situationShadow.concept_count,
        candidate_count: situationShadow.items.length,
        qualified_candidate_count: situationShadow.items.filter((item) => item.qualified).length,
        simulated_admission_count: traceCandidates.filter((item) =>
          item.situation_admission_simulation === "admit").length,
        final_overlap_count: situationFinalOverlap,
        final_overlap_ratio: memories.length ? round(situationFinalOverlap / memories.length) : 0,
      },
      vector: {
        enabled: Boolean(vectorResult?.enabled),
        mode: vectorResult?.mode || "off",
        activation_enabled: Boolean(vectorActivationEnabled),
        backend: vectorResult?.backend || "qdrant",
        degraded: Boolean(vectorResult?.degraded),
        reason: vectorResult?.reason || null,
        sync_error: vectorResult?.sync_error || null,
        phases_ms: vectorResult?.phases_ms || {},
        model: vectorResult?.model || null,
        dimensions: vectorResult?.dimensions || null,
        collection: vectorResult?.collection || null,
        query_count: vectorResult?.query_count || 0,
        indexed_count: vectorResult?.indexed_count || 0,
        eligible_count: vectorResult?.eligible_count || 0,
        pending_count: vectorResult?.pending_count || 0,
        indexed_now: vectorResult?.indexed_now || 0,
        candidate_count: vectorResult?.candidate_count || 0,
        qualified_candidate_count: vectorResult?.qualified_count || 0,
        activation_candidate_count: traceCandidates.filter((item) => item.vector_activated).length,
        final_overlap_count: vectorFinalOverlap,
        final_overlap_ratio: memories.length ? round(vectorFinalOverlap / memories.length) : 0,
      },
      association: {
        enabled: Boolean(associationResult?.enabled),
        mode: associationResult?.mode || "off",
        phases_ms: associationResult?.phases_ms || {},
        activation_enabled: Boolean(associationActivationEnabled),
        degraded: Boolean(associationResult?.degraded),
        reason: associationResult?.reason || null,
        query_count: associationResult?.query_count || 0,
        candidate_count: associationResult?.candidate_count || 0,
        qualified_candidate_count: associationResult?.qualified_count || 0,
        final_overlap_count: associationFinalOverlap,
        final_overlap_ratio: memories.length ? round(associationFinalOverlap / memories.length) : 0,
      },
      final_ids: memories.map((memory) => memory.id),
      candidates: traceCandidates,
      latency_ms: round(elapsedMs),
      latency_scope: "final-pipeline",
    },
  };
}
