import { admissionDecision } from "./admission.js";
import { associationBridge } from "./association.js";
import { MIN_RELEVANCE_SCORE } from "./constants.js";
import { resolveRecallEvidence, scoreContextualEvidence } from "./evidence.js";

export function candidateSignals(runtime, memory, { query, context, intimacyMode }) {
  const rawEvidence = runtime.queryContext.scoreMemory(memory, query);
  const contextualEvidence = scoreContextualEvidence(memory, runtime.envelope, runtime.queryContext.scoreMemory);
  const evidence = resolveRecallEvidence(rawEvidence, contextualEvidence);
  const entityIds = runtime.entityMatches.get(memory.id) || [];
  if (entityIds.length) {
    evidence.discoveryScore = Math.max(evidence.discoveryScore, 6);
    evidence.answerScore = Math.max(evidence.answerScore, 6);
  }
  const discoveryScore = evidence.discoveryScore;
  const situationDecision = runtime.situationActivationDecisions.get(memory.id) || null;
  const situationTriggerEvidence = Boolean(situationDecision?.tailEligible);
  const vectorCandidate = runtime.vectorById.get(memory.id) || null;
  const vectorEvidence = Boolean(runtime.vectorActivationEnabled && vectorCandidate?.qualified);
  const associationCandidate = runtime.associationById.get(memory.id) || null;
  const seedMemory = associationCandidate?.seed_id
    ? runtime.loadedById.get(associationCandidate.seed_id)
    : null;
  const bridge = associationBridge(seedMemory, memory, {
    queryVector: runtime.vectorActivationEnabled ? vectorCandidate : null,
  });
  const associationQualified = Boolean(
    runtime.associationActivationEnabled
    && associationCandidate?.qualified
    && bridge.qualified
    && !rawEvidence.direct
    && !evidence.contextual,
  );
  const associationCandidateEvidence = associationQualified && !vectorEvidence;
  const mayUnlockBody = runtime.queryContext.mayUnlockBody;
  const trustedSituationEvidence = runtime.situationActivationEnabled
    && situationTriggerEvidence && mayUnlockBody;
  const admission = admissionDecision(memory, {
    query, context, intimacyMode,
    allowedStatuses: runtime.recallPlan.candidate_statuses,
    trustedEvidence: trustedSituationEvidence ? "situation" : null,
  });
  const simulatedAdmission = situationTriggerEvidence && mayUnlockBody && !trustedSituationEvidence
    ? admissionDecision(memory, {
        query, context, intimacyMode,
        trustedEvidence: mayUnlockBody ? "situation" : null,
        allowedStatuses: runtime.recallPlan.candidate_statuses,
      })
    : admission;
  const situationNeedsRescue = discoveryScore < MIN_RELEVANCE_SCORE;
  const situationEvidence = runtime.situationActivationEnabled
    && (situationNeedsRescue
      ? runtime.situationAdmissionActivationIds.has(memory.id)
      : runtime.situationTailActivationIds.has(memory.id));
  const associationEvidence = associationCandidateEvidence && !situationEvidence;

  return {
    rawEvidence, contextualEvidence, evidence, discoveryScore, entityIds,
    situationDecision, situationEvidence,
    vectorCandidate, vectorEvidence,
    associationCandidate, associationQualified, associationEvidence,
    seedMemory, bridge,
    admission, simulatedAdmission,
  };
}
