import {
  ACTIVATION_RRF_K, ACTIVATION_RRF_WEIGHTS, CONTEXTUAL_TAIL_RATIO, MAX_CONTEXTUAL_RELEVANCE_FLOOR,
  MAX_RELATIVE_RELEVANCE_FLOOR, MIN_RELEVANCE_SCORE, RELATIVE_TAIL_RATIO, SITUATION_ACTIVATION_CONFIDENCE_RATIO,
} from "./constants.js";
import { round } from "./runtime.js";

export function compareVersions(a, b) {
  return (b.version || 1) - (a.version || 1) || String(b.updated_at).localeCompare(String(a.updated_at));
}

export function selectRecallRepresentatives(entries, { distinctFamilies = new Set() } = {}) {
  const seenFamilies = new Set();
  const seenBodies = new Set();
  const selected = [];
  const suppressed = new Map();
  for (const entry of entries) {
    const { memory } = entry;
    const family = memory.family_branch_key || memory.family_key || memory.id;
    const body = normalizedBody(memory.content);
    if (seenFamilies.has(family) && !distinctFamilies.has(memory.family_key || memory.id)) {
      suppressed.set(memory.id, "family-representative");
      continue;
    }
    if (body && seenBodies.has(body)) {
      suppressed.set(memory.id, "duplicate-content");
      continue;
    }
    seenFamilies.add(family);
    if (body) seenBodies.add(body);
    selected.push(entry);
  }
  return { selected, suppressed };
}

export function lexicalRankBoost(rank) {
  const position = Number(rank);
  if (!Number.isFinite(position) || position < 1) return 0;
  return Math.max(0.25, 2.5 - (position - 1) * 0.15);
}

export function vectorRankBoost(rank) {
  const position = Number(rank);
  if (!Number.isFinite(position) || position < 1) return 0;
  return Math.max(0.35, 3.0 - (position - 1) * 0.12);
}

export function associationRankBoost(rank) {
  const position = Number(rank);
  if (!Number.isFinite(position) || position < 1) return 0;
  return Math.max(0.2, 1.4 - (position - 1) * 0.08);
}


export function calculateRelativeRelevanceFloor(entries) {
  const topRelevance = Math.max(...entries.map((entry) => entry.discoveryScore));
  return round(Math.max(
    MIN_RELEVANCE_SCORE,
    Math.min(MAX_RELATIVE_RELEVANCE_FLOOR, topRelevance * RELATIVE_TAIL_RATIO),
  ));
}

export function calculateContextualRelevanceFloor(entries) {
  const contextual = entries.filter((entry) => entry.contextualMatch);
  const topRelevance = Math.max(...contextual.map((entry) => entry.discoveryScore));
  return round(Math.max(
    MIN_RELEVANCE_SCORE,
    Math.min(MAX_CONTEXTUAL_RELEVANCE_FLOOR, topRelevance * CONTEXTUAL_TAIL_RATIO),
  ));
}


export function freshnessBoost(memory) {
  if (!memory.last_recalled_at) return 8;
  const ageDays = (Date.now() - Date.parse(memory.last_recalled_at)) / 86_400_000;
  return Math.min(Math.max(ageDays / 7, 0), 8);
}

export function recentSets(ids, hashes, families) {
  return { ids: new Set(ids), hashes: new Set(hashes), families: new Set(families) };
}

export function isRecentlyRead(memory, recent) {
  return recent.ids.has(memory.id) || recent.hashes.has(memory.content_hash)
    || recent.families.has(memory.family_key) || recent.families.has(memory.family_branch_key);
}

export function compareScored(a, b) {
  return b.score - a.score
    || b.memory.importance - a.memory.importance
    || compareVersions(a.memory, b.memory)
    || compareMemoryIds(a.memory, b.memory);
}

export function compareActivatedScored(a, b) {
  return (Number(b.activationHybridScore) || 0) - (Number(a.activationHybridScore) || 0)
    || compareScored(a, b);
}

export function compareMemoryIds(a, b) {
  const left = String(a?.id ?? a);
  const right = String(b?.id ?? b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function rankWithHybridEvidence(entries, situationById, vectorById) {
  const baseline = [...entries].sort(compareScored);
  const formalPositions = new Map(baseline.map((entry, index) => [entry.memory.id, index + 1]));
  return baseline.map((entry) => {
    const formalPosition = formalPositions.get(entry.memory.id) || baseline.length;
    const situation = situationById.get(entry.memory.id);
    const vector = vectorById.get(entry.memory.id);
    const situationContribution = entry.situationEvidence && situation?.qualified
      ? ACTIVATION_RRF_WEIGHTS.situation / (ACTIVATION_RRF_K + situation.rank)
      : 0;
    const vectorContribution = entry.vectorEvidence && vector?.qualified
      ? ACTIVATION_RRF_WEIGHTS.vector / (ACTIVATION_RRF_K + vector.rank)
      : 0;
    const hybrid = ACTIVATION_RRF_WEIGHTS.formal / (ACTIVATION_RRF_K + formalPosition)
      + situationContribution + vectorContribution;
    return {
      ...entry,
      formalPositionBeforeActivation: formalPosition,
      activationHybridScore: round(hybrid * 100000),
    };
  }).sort((a, b) => b.activationHybridScore - a.activationHybridScore || compareScored(a, b));
}

export const rankWithSituationEvidence = (entries, situationById) =>
  rankWithHybridEvidence(entries, situationById, new Map());

export function selectSituationActivationCandidates(items) {
  const qualified = items.filter((item) => item?.qualified);
  if (!qualified.length) return new Map();
  const leading = qualified[0];
  const referenceConfidence = activationConfidence(leading);
  return new Map(qualified.map((item) => {
    const confidence = activationConfidence(item);
    const querySpecific = Boolean(item.lexical_qualified)
      && Number(item.query_match_count) >= 2
      && Boolean(item.query_anchor_qualified);
    const inContextConfidenceBand = Boolean(item.overlap_qualified)
      && (item.id === leading.id
        || referenceConfidence <= 0
        || confidence >= referenceConfidence * SITUATION_ACTIVATION_CONFIDENCE_RATIO);
    const leadingQualifiedFallback = item.id === leading.id
      && !inContextConfidenceBand;
    let reason = "below-confidence-band";
    if (querySpecific) reason = "query-specific-lexical";
    else if (inContextConfidenceBand) reason = item.id === leading.id
      ? "leading-context-evidence"
      : "context-confidence-band";
    else if (leadingQualifiedFallback) reason = "leading-qualified-fallback";
    return [item.id, {
      eligible: querySpecific || inContextConfidenceBand || leadingQualifiedFallback,
      tailEligible: inContextConfidenceBand || leadingQualifiedFallback,
      reason,
      confidence: round(confidence),
      referenceConfidence: round(referenceConfidence),
    }];
  }));
}

export function activationConfidence(item) {
  return Math.max(0, Number(item?.overlap_score) || 0)
    * Math.max(0, Number(item?.coverage) || 0);
}

export function uniqueById(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function normalizedBody(content) {
  return String(content || "").normalize("NFKC").toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}
