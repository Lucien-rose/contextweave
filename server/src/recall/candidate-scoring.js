import { MIN_RELEVANCE_SCORE } from "./constants.js";
import { associationRankBoost, freshnessBoost, lexicalRankBoost, vectorRankBoost } from "./ranking.js";
import { evergreenPriorityBoost, importanceBoost, matchReason, mentionabilityBoost } from "./presentation.js";

export function scoreCandidate(memory, signals, runtime, { query, allowRepeatIfStale }) {
  const semanticEvidence = signals.situationEvidence || signals.vectorEvidence || signals.associationEvidence;
  const answerScore = Math.max(signals.evidence.answerScore, semanticEvidence ? MIN_RELEVANCE_SCORE : 0);
  const lexicalBoost = lexicalRankBoost(runtime.ftsShadowRanks.get(memory.id));
  const vectorBoost = signals.vectorEvidence ? vectorRankBoost(signals.vectorCandidate?.rank) : 0;
  const associationBoost = signals.associationEvidence
    ? associationRankBoost(signals.associationCandidate?.association_rank) : 0;
  const evergreenBoost = runtime.queryFocus?.applied ? 0 : evergreenPriorityBoost(memory);
  const score = answerScore
    + lexicalBoost
    + vectorBoost
    + associationBoost
    + importanceBoost(memory)
    + mentionabilityBoost(memory)
    + evergreenBoost
    + (allowRepeatIfStale ? freshnessBoost(memory) : 0);
  const reason = matchReason(memory, query, { contextualMatch: signals.evidence.contextual });
  return { score, answerScore, lexicalBoost, vectorBoost, associationBoost, evergreenBoost, reason };
}

export function evidenceLabel(signals) {
  if (signals.associationEvidence) return "association-strong";
  if (signals.vectorEvidence) return "vector-strong";
  if (signals.situationEvidence) return "situation-strong";
  if (signals.evidence.contextual) return signals.evidence.direct ? "contextual-direct" : "contextual-weak";
  return signals.evidence.direct ? "direct" : "weak";
}

export function admissionReason(signals) {
  if (signals.associationEvidence && signals.discoveryScore < MIN_RELEVANCE_SCORE) return "association-relevance-signal";
  if (signals.vectorEvidence && signals.discoveryScore < MIN_RELEVANCE_SCORE) return "vector-relevance-signal";
  if (signals.situationEvidence && signals.discoveryScore < MIN_RELEVANCE_SCORE) return "situation-relevance-signal";
  return "relevance-signal";
}
