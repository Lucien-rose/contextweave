import { defaults } from "../defaults.js";
import { excerpt } from "./presentation.js";

// Keep identity, policy and expansion semantics intact. Retrieval/debug metadata
// remains in the trace and canonical record rather than crowding the live cue.
export function compactRecallCue(presentation, { excerptLimit = 120 } = {}) {
  const {
    content, tags, triggers, ambient_triggers, source, importance, layer, policy_origin,
    read_via, relations_via, arc_memberships, arc_membership_coverage, entities, summary_recommended,
    match_reason, recall_reason, recommended_mode, already_recently_read,
    answer_authority: answerAuthority,
    ...cue
  } = presentation;
  return {
    ...cue,
    ...(content ? { detail_level: "cue", content_omitted: true } : {}),
    ...(answerAuthority ? { answer_authority: {
      lifecycle_state: answerAuthority.lifecycle_state,
      answer_policy: answerAuthority.answer_policy,
    } } : {}),
    excerpt: cue.excerpt ? excerpt(cue.excerpt, excerptLimit) : cue.excerpt,
  };
}

export function selectByRecallBudget(items, {
  maxItems = 10,
  charBudget = defaults.mainChars,
  presentSelected = null,
} = {}) {
  const itemLimit = Math.max(1, Math.min(12, Number(maxItems) || 10));
  const budget = Math.max(1200, Math.min(12000, Number(charBudget) || defaults.mainChars));
  const candidates = items.map((item) => {
    const compact = compactRecallCue(item.presentation, { excerptLimit: item.entry.recallTier === "T0" ? 360 : 120 });
    return { ...item, compact, compactChars: serializedSize(compact) };
  });
  const chosen = new Set();
  let selectedChars = 0;
  let protectedSidecarId = null;

  function choose(item, preserveDirect = false) {
    if (chosen.has(item)) return true;
    const size = item.compactChars;
    if (chosen.size >= itemLimit || (!preserveDirect && selectedChars + size > budget)) return false;
    chosen.add(item);
    selectedChars += size;
    return true;
  }

  // Preserve the existing soft-budget contract for direct evidence, within the
  // item ceiling. Supporting/associative cues never bypass the character budget.
  for (const item of candidates.filter(isDirect)) choose(item, true);
  const firstSupporting = candidates.find((item) => item.entry.recallTier === "T1");
  if (firstSupporting) choose(firstSupporting);
  const sidecars = candidates
    .filter(isProtectedAssociationCandidate)
    .sort(compareProtectedAssociation);
  for (const sidecar of sidecars) {
    if (!choose(sidecar)) continue;
    protectedSidecarId = sidecar.entry.memory.id;
    break;
  }

  // Decide membership using compact costs before spending space on detail.
  for (const item of candidates) choose(item);
  const presentations = presentSelected?.([...chosen].map(({ entry }) => entry));
  const selected = [];
  const skippedIds = [];
  const decisions = new Map();
  let overflowMemoryId = null;
  for (const item of candidates) {
    const id = item.entry.memory.id;
    const compactChars = item.compactChars;
    if (!chosen.has(item)) {
      skippedIds.push(id);
      decisions.set(id, {
        presentation_chars: compactChars,
        presentation_mode: isDirect(item) ? "normal" : "compact",
        packing_decision: chosen.size >= itemLimit ? "skipped_limit" : "skipped_budget",
      });
      continue;
    }
    const normal = presentations?.get(id) || item.presentation;
    const normalChars = serializedSize(normal);
    const exceedsSoft = selectedChars + normalChars - compactChars > budget;
    const allowOverflow = !overflowMemoryId && isDirect(item) && normal.content
      && selectedChars + normalChars - compactChars <= 22000;
    const useNormal = !exceedsSoft || allowOverflow;
    if (useNormal && exceedsSoft) overflowMemoryId = id;
    const presentation = useNormal ? normal : item.compact;
    if (useNormal) selectedChars += normalChars - compactChars;
    selected.push({ entry: item.entry, presentation });
    decisions.set(id, {
      presentation_chars: useNormal ? normalChars : compactChars,
      presentation_mode: useNormal ? "normal" : "compact",
      packing_decision: useNormal ? exceedsSoft ? "single-whole-memory-overflow" : "selected" : "compacted",
    });
  }
  return { selected, selectedChars, charBudget: budget, maxItems: itemLimit,
    skippedIds, decisions, protectedSidecarId, overflowMemoryId };
}

export function annotatePackingTrace(candidates, budget) {
  for (const candidate of candidates) {
    const decision = budget.decisions.get(candidate.id);
    if (decision) Object.assign(candidate, decision);
  }
}

// A full T1 seed pass may still yield space after compact packing. Only direct
// evidence can exhaust the budget before association has had a chance to run.
export function hasAssociationRoom(seedPass, input) {
  const limit = Math.min(12, Math.max(1, Number(input.limit) || 5));
  const direct = (seedPass.memories || []).filter((memory) => memory.recall_tier === "T0");
  if (direct.length >= limit) return false;
  const budget = seedPass.trace?.context_budget?.char_budget ?? defaults.mainChars;
  return direct.reduce((sum, memory) => sum + serializedSize(memory), 0) < budget;
}

function isDirect(item) {
  return item.entry.recallTier === "T0";
}

function isProtectedAssociationCandidate(item) {
  const entry = item.entry;
  if (!entry.associationQualified && !entry.associationEvidence) return false;
  if (!["ambient", "policy"].includes(entry.recallRole)) return true;
  return hasIndependentQueryEvidence(entry);
}

function compareProtectedAssociation(left, right) {
  const independentDifference = Number(hasIndependentQueryEvidence(right.entry))
    - Number(hasIndependentQueryEvidence(left.entry));
  if (independentDifference) return independentDifference;
  const relevanceDifference = queryEvidenceScore(right.entry) - queryEvidenceScore(left.entry);
  if (relevanceDifference) return relevanceDifference;
  const marginDifference = associationMargin(right.entry) - associationMargin(left.entry);
  if (marginDifference) return marginDifference;
  const leftRank = Number(left.entry.associationRank) || Number.POSITIVE_INFINITY;
  const rightRank = Number(right.entry.associationRank) || Number.POSITIVE_INFINITY;
  return leftRank - rightRank
    || String(left.entry.memory.id).localeCompare(String(right.entry.memory.id));
}

function hasIndependentQueryEvidence(entry) {
  return Boolean(entry.rawDirectEvidence
    || entry.contextualMatch
    || entry.situationEvidence
    || entry.vectorEvidence
    || Number(entry.lexicalBoost) > 0);
}

function queryEvidenceScore(entry) {
  return (Number(entry.discoveryScore) || 0)
    + (Number(entry.lexicalBoost) || 0)
    + (Number(entry.vectorBoost) || 0)
    + (entry.situationEvidence ? 3 : 0)
    + (entry.contextualMatch ? 2 : 0);
}

function associationMargin(entry) {
  return (Number(entry.associationSimilarity) || 0) - (Number(entry.associationThreshold) || 0);
}

function serializedSize(presentation) {
  return JSON.stringify(presentation).length;
}
