import { createHash } from "node:crypto";
import { retrievalRole } from "../search-projection.js";
import { chronicleEvidenceTrace } from "./chronicle-evidence.js";
import { normalize } from "./runtime.js";

export function traceIdentity(
  memory,
  ftsShadowRanks = new Map(),
  situationShadowById = new Map(),
  situationActivationDecisions = new Map(),
  vectorById = new Map(),
  associationById = new Map(),
) {
  const shadowRank = ftsShadowRanks.get(memory.id) || null;
  const situation = situationShadowById.get(memory.id) || null;
  const activation = situationActivationDecisions.get(memory.id) || null;
  const vector = vectorById.get(memory.id) || null;
  const association = associationById.get(memory.id) || null;
  const candidateSources = ["full-scan"];
  if (shadowRank) candidateSources.push("fts-shadow");
  if (situation) candidateSources.push("situation-shadow");
  if (vector) candidateSources.push("vector");
  if (association) candidateSources.push("association");
  return {
    id: memory.id,
    family_key: memory.family_key,
    sensitivity: memory.sensitivity,
    status: memory.status,
    layer: memory.layer,
    retrieval_role: retrievalRole(memory),
    ...chronicleEvidenceTrace(memory),
    candidate_sources: candidateSources,
    fts_shadow_rank: shadowRank,
    situation_shadow_rank: situation?.rank || null,
    situation_lexical_position: situation?.lexical_position || null,
    situation_overlap_position: situation?.overlap_position || null,
    situation_hybrid_score: situation?.hybrid_score || 0,
    situation_overlap_count: situation?.overlap_count || 0,
    situation_overlap_score: situation?.overlap_score || 0,
    situation_coverage: situation?.coverage || 0,
    situation_query_match_count: situation?.query_match_count || 0,
    situation_context_match_count: situation?.context_match_count || 0,
    situation_structured_query_match_count: situation?.structured_query_match_count || 0,
    situation_selective_query_anchor_count: situation?.selective_query_anchor_count || 0,
    situation_query_anchor_selectivity: situation?.query_anchor_selectivity || 0,
    situation_query_anchor_qualified: Boolean(situation?.query_anchor_qualified),
    situation_overlap_qualified: Boolean(situation?.overlap_qualified),
    situation_lexical_qualified: Boolean(situation?.lexical_qualified),
    situation_shadow_qualified: Boolean(situation?.qualified),
    situation_activation_eligible: Boolean(activation?.eligible),
    situation_activation_tail_eligible: Boolean(activation?.tailEligible),
    situation_activation_reason: activation?.reason || null,
    situation_activation_confidence: activation?.confidence || 0,
    situation_activation_reference_confidence: activation?.referenceConfidence || 0,
    vector_rank: vector?.rank || null,
    vector_similarity: vector?.similarity || 0,
    vector_threshold: vector?.threshold || 0,
    vector_absolute_threshold: vector?.absolute_threshold ?? null,
    vector_absolute_qualified: Boolean(vector?.absolute_qualified),
    vector_qualified: Boolean(vector?.qualified),
    association_rank: association?.association_rank || null,
    association_similarity: association?.similarity || 0,
    association_threshold: association?.threshold || 0,
    association_qualified: Boolean(association?.qualified),
    association_seed_id: association?.seed_id || null,
  };
}

export function situationSimulation(base, policyAllowed, formalReason) {
  if (!base.situation_shadow_rank) {
    return { situation_admission_simulation: null, situation_simulation_reason: null };
  }
  if (!policyAllowed) {
    return { situation_admission_simulation: "reject", situation_simulation_reason: formalReason };
  }
  if (!base.situation_shadow_qualified) {
    return { situation_admission_simulation: "reject", situation_simulation_reason: "low-confidence-situation-match" };
  }
  return {
    situation_admission_simulation: "admit",
    situation_simulation_reason: formalReason === "no-relevance-signal"
      ? "high-confidence-situation-match"
      : formalReason === "private-situation-trigger-route"
      ? "high-confidence-situation-trigger"
      : "formal-relevance-already-admitted",
  };
}

export function countRetrievalRoles(memories) {
  const counts = { direct_seed: 0, context_only: 0, source_only: 0 };
  for (const memory of memories) counts[retrievalRole(memory)] += 1;
  return counts;
}

export function queryFingerprint(query) {
  return createHash("sha256").update(normalize(query), "utf8").digest("hex").slice(0, 16);
}
