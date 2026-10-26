import { admissionDecision, shouldSuppressPrivateTechnicalWeakOnly } from "./admission.js";
import { evidenceLabel, admissionReason, scoreCandidate } from "./candidate-scoring.js";
import { candidateSignals } from "./candidate-signals.js";
import { MIN_RELEVANCE_SCORE } from "./constants.js";
import { historicalSuppressionReason } from "./history-plan.js";
import { isRecentlyRead } from "./ranking.js";
import { matchReason } from "./presentation.js";
import { round } from "./runtime.js";
import { situationSimulation, traceIdentity } from "./trace.js";
import { publicRecallProjection } from "../memory-summary.js";

export function evaluateCandidates(runtime, {
  query, context, intimacyMode, includeArchived, allowRepeat, allowRepeatIfStale, recent, captureCandidates = false,
}) {
  const traceCandidates = [];
  const scored = [];
  const observed = [];

  for (const original of runtime.loaded) {
    const memory = publicRecallProjection(original, context);
    const base = traceIdentity(
      memory,
      runtime.ftsShadowRanks,
      runtime.situationShadowById,
      runtime.situationActivationDecisions,
      runtime.vectorById,
      runtime.associationById,
    );
    if (memory.family_branch_key) base.family_branch_key = memory.family_branch_key;
    const early = earlyCandidateDecision(memory, runtime, base, { includeArchived });
    if (early) {
      traceCandidates.push(early);
      continue;
    }

    const signals = candidateSignals(runtime, memory, { query, context, intimacyMode });
    base.candidate_generated = signals.discoveryScore >= MIN_RELEVANCE_SCORE
      || signals.situationEvidence || signals.vectorEvidence || signals.associationEvidence;
    if (captureCandidates && (allowRepeat || !isRecentlyRead(memory, recent))) {
      const processing = admissionDecision(memory, { query, context, intimacyMode,
        allowedStatuses: runtime.recallPlan.candidate_statuses, modelInspection: true });
      if (processing.allowed && !historicalSuppressionReason(runtime.recallPlan, memory, runtime.historicalFamilyKeys, { contextualMatch: signals.evidence.contextual, canonicalMatchReason: matchReason(memory, query) })) observed.push({
        formalAllowed: signals.admission.allowed && !shouldSuppressPrivateTechnicalWeakOnly(memory, { query, context, intimacyMode, admission: signals.admission, rawEvidence: signals.rawEvidence, technicalIntent: runtime.technicalIntent }),
        entry: admittedCandidate(memory, runtime, signals, base, { query, allowRepeatIfStale }).entry,
      });
    }
    if (!signals.admission.allowed) {
      traceCandidates.push({
        ...base, admission: "reject", reason: signals.admission.reason,
        ...situationSimulation(base, signals.simulatedAdmission.allowed,
          signals.simulatedAdmission.allowed ? signals.simulatedAdmission.reason : signals.admission.reason),
      });
      continue;
    }

    base.policy_allowed = true;
    const rejected = admittedCandidateRejection(memory, runtime, signals, base, {
      query, context, intimacyMode, allowRepeat, recent,
    });
    if (rejected) {
      traceCandidates.push(rejected);
      continue;
    }

    const scoredCandidate = admittedCandidate(memory, runtime, signals, base, {
      query, allowRepeatIfStale,
    });
    scored.push(scoredCandidate.entry);
    traceCandidates.push(scoredCandidate.trace);
  }
  return { scored, traceCandidates, observed };
}

function earlyCandidateDecision(memory, runtime, base, { includeArchived }) {
  if (!includeArchived && memory.layer === "archive") {
    return {
      ...base,
      admission: "reject",
      reason: "archive-excluded",
      ...situationSimulation(base, false, "archive-excluded"),
    };
  }
  const reason = historicalSuppressionReason(runtime.recallPlan, memory, runtime.historicalFamilyKeys);
  if (!reason) return null;
  return {
    ...base,
    admission: "suppress",
    reason,
    ...situationSimulation(base, false, reason),
  };
}

function admittedCandidateRejection(memory, runtime, signals, base, {
  query, context, intimacyMode, allowRepeat, recent,
}) {
  if (!allowRepeat && isRecentlyRead(memory, recent)) {
    return { ...base, admission: "reject", reason: "recently-read",
      ...situationSimulation(base, false, "recently-read") };
  }
  const historyReason = historicalSuppressionReason(runtime.recallPlan, memory, runtime.historicalFamilyKeys, {
    contextualMatch: signals.evidence.contextual,
    canonicalMatchReason: matchReason(memory, query),
  });
  if (historyReason) {
    return { ...base, admission: "suppress", reason: historyReason,
      ...evidenceTrace(signals), evidence: "weak",
      ...situationSimulation(base, false, historyReason) };
  }
  const semanticEvidence = signals.situationEvidence || signals.vectorEvidence || signals.associationEvidence;
  if (signals.discoveryScore < MIN_RELEVANCE_SCORE && !semanticEvidence) {
    return { ...base, admission: "reject", reason: "no-relevance-signal",
      ...situationSimulation(base, true, "no-relevance-signal") };
  }
  if (shouldSuppressPrivateTechnicalWeakOnly(memory, {
    query, context, intimacyMode,
    admission: signals.admission,
    rawEvidence: signals.rawEvidence,
    technicalIntent: runtime.technicalIntent,
  })) {
    return {
      ...base,
      admission: "suppress",
      reason: "private-technical-weak-only",
      admission_reason: signals.admission.reason,
      ...evidenceTrace(signals),
      evidence: "weak",
      ...situationSimulation(base, false, "private-technical-weak-only"),
    };
  }
  return null;
}

function admittedCandidate(memory, runtime, signals, base, { query, allowRepeatIfStale }) {
  const scoring = scoreCandidate(memory, signals, runtime, { query, allowRepeatIfStale });
  return {
    entry: scoredEntry(memory, signals, scoring, {
      directEvidence: signals.evidence.direct || signals.situationEvidence,
      situationEvidence: signals.situationEvidence,
      contextEnvelopePresent: runtime.envelope.present,
      projectionOnly: Boolean(memory.public_projection_only),
    }),
    trace: admittedTrace(base, signals, scoring, {
      reason: admissionReason(signals),
      evidence: evidenceLabel(signals),
      simulationAllowed: true,
      simulationReason: "formal-relevance-already-admitted",
    }),
  };
}

function scoredEntry(memory, signals, scoring, {
  directEvidence, situationEvidence, contextEnvelopePresent, projectionOnly = false,
}) {
  return {
    memory,
    score: scoring.score,
    discoveryScore: signals.discoveryScore,
    answerScore: scoring.answerScore,
    directEvidence,
    contextualMatch: signals.evidence.contextual,
    rawDirectEvidence: Boolean(signals.rawEvidence.strongDirect),
    rawEvidenceScore: Number(signals.rawEvidence.score) || 0,
    // Entity aliases are explicit identity navigation, never direct evidence.
    entityEvidence: signals.entityIds.length > 0,
    contextEnvelopePresent: Boolean(contextEnvelopePresent),
    contextualEvidenceScore: Number(signals.contextualEvidence?.score) || 0,
    matchReason: scoring.reason,
    situationEvidence,
    vectorEvidence: signals.vectorEvidence,
    vectorChunk: signals.vectorCandidate,
    associationQualified: signals.associationQualified,
    associationEvidence: signals.associationEvidence,
    associationRank: Number(signals.associationCandidate?.association_rank) || null,
    associationSimilarity: Number(signals.associationCandidate?.similarity) || 0,
    associationThreshold: Number(signals.associationCandidate?.threshold) || 0,
    associationSeedId: signals.associationCandidate?.seed_id || null,
    associationSeedTitle: signals.seedMemory?.title || null,
    associationBridge: signals.bridge.cue,
    lexicalBoost: scoring.lexicalBoost,
    vectorBoost: scoring.vectorBoost,
    associationBoost: scoring.associationBoost,
    projectionOnly,
  };
}

function admittedTrace(base, signals, scoring, {
  reason, evidence, simulationAllowed, simulationReason,
}) {
  return {
    ...base,
    entity_ids: signals.entityIds,
    candidate_sources: [...base.candidate_sources, ...(signals.entityIds.length ? ["entity"] : [])],
    admission: "admit",
    reason,
    admission_reason: signals.admission.reason,
    score: round(scoring.score),
    lexical_rank_boost: round(scoring.lexicalBoost),
    vector_rank_boost: round(scoring.vectorBoost),
    association_rank_boost: round(scoring.associationBoost),
    evergreen_priority_boost: round(scoring.evergreenBoost),
    ...evidenceTrace(signals, scoring.answerScore),
    evidence,
    association_bridge: signals.associationQualified ? signals.bridge.cue : null,
    match_reason: scoring.reason,
    ...situationSimulation(base, simulationAllowed, simulationReason),
  };
}

function evidenceTrace(signals, answerScore = signals.evidence.answerScore) {
  return {
    relevance_score: round(signals.discoveryScore),
    discovery_score: round(signals.discoveryScore),
    answer_score: round(answerScore),
    raw_evidence_score: round(Number(signals.rawEvidence?.score) || 0),
    contextual_evidence_score: round(Number(signals.contextualEvidence?.score) || 0),
  };
}
