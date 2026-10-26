import { directReading } from "./direct-reading.js";
import { excerpt } from "./presentation.js";

const TIER_ORDER = Object.freeze({ T0: 0, T1: 1, T2: 2 });
const DETAIL_EXCERPT_LIMIT = Object.freeze({ T0: 360, T1: 220, T2: 140 });
const T1_CONTEXTUAL_RELATED_SCORE = 6;

export function assignRecallSemantics(entries) {
  return entries.map((entry) => {
    const recallTier = recallTierFor(entry);
    const recallRole = recallRoleFor(entry, recallTier);
    return {
      ...entry,
      recallTier,
      recallRole,
      recallQualified: Boolean(recallTier),
      evidenceType: evidenceTypeFor(recallTier, recallRole),
      recallReason: recallReasonFor(entry, recallTier, recallRole),
      recallPath: recallPathFor(entry, recallTier),
      sourceChannels: sourceChannelsFor(entry),
    };
  });
}

export function compareTiered(a, b, compareWithinTier) {
  return (TIER_ORDER[a.recallTier] ?? 9) - (TIER_ORDER[b.recallTier] ?? 9)
    || compareWithinTier(a, b);
}

export function associationSeedIds(memories, maxSeeds = 4) {
  return memories
    .filter((memory) => ["T0", "T1"].includes(memory.recall_tier))
    .filter((memory) => memory.recall_role !== "ambient")
    .slice(0, Math.max(0, Number(maxSeeds) || 0))
    .map((memory) => memory.id);
}

export function progressivePresentation(entry, summary) {
  const tier = entry.recallTier || "T1";
  const role = entry.recallRole || "supporting";
  const limit = role === "ambient" ? 180 : DETAIL_EXCERPT_LIMIT[tier] || 220;
  const cueOnly = tier !== "T0" || role === "ambient";
  return {
    ...summary,
    ...(summary.excerpt ? { excerpt: excerpt(summary.excerpt, limit) } : {}),
    ...(cueOnly ? {
      tags: (summary.tags || []).slice(0, 8),
      triggers: (summary.triggers || []).slice(0, 8),
      ambient_triggers: (summary.ambient_triggers || []).slice(0, 8),
    } : {}),
    ...recallPresentation(entry),
    ...(!cueOnly ? directReading(entry) : {}),
  };
}

export function recallPresentation(entry) {
  const detailLevel = entry.recallTier === "T0" && entry.recallRole !== "ambient" ? "summary" : "cue";
  return {
    recall_tier: entry.recallTier,
    recall_role: entry.recallRole,
    evidence_type: entry.evidenceType,
    recall_reason: entry.recallReason,
    recall_path: entry.recallPath,
    source_channels: entry.sourceChannels,
    expandable: !entry.projectionOnly,
    detail_level: entry.projectionOnly ? "public_projection" : detailLevel,
    content_available: true,
    canonical_content_available: !entry.projectionOnly,
    ...(entry.answerAuthority ? { answer_authority: entry.answerAuthority } : {}),
  };
}

export function annotateTraceSemantics(traceCandidates, entries) {
  const byId = new Map(entries.map((entry) => [entry.memory.id, entry]));
  for (const candidate of traceCandidates) {
    const entry = byId.get(candidate.id);
    if (!entry) continue;
    candidate.recall_qualified = entry.recallQualified;
    candidate.recall_tier = entry.recallTier;
    candidate.recall_role = entry.recallRole;
    candidate.evidence_type = entry.evidenceType;
    candidate.answer_authority = entry.answerAuthority || null;
    candidate.association_seed_id = entry.associationSeedId || candidate.association_seed_id || null;
    if (!entry.recallQualified && candidate.admission === "admit") {
      candidate.admission = "suppress";
      candidate.reason = "progressive-unqualified";
    }
  }
}

export function tierCounts(memories) {
  const counts = { T0: 0, T1: 0, T2: 0 };
  for (const memory of memories) {
    if (Object.hasOwn(counts, memory.recall_tier)) counts[memory.recall_tier] += 1;
  }
  return counts;
}

function recallTierFor(entry) {
  if (entry.semanticBackground) return "T1";
  if (entry.rawDirectEvidence) return "T0";
  if (entry.entityEvidence) return "T1";
  if (entry.associationEvidence) return "T2";
  if (entry.semanticDecision) return "T1";
  if (isAmbientEntry(entry)) return "T1";
  if (entry.situationEvidence || entry.vectorEvidence) return "T1";
  if (entry.contextualMatch && entry.contextualEvidenceScore >= T1_CONTEXTUAL_RELATED_SCORE) return "T1";
  if (!entry.contextEnvelopePresent && entry.rawEvidenceScore > 0) return "T1";
  return null;
}

function isAmbientEntry(entry) {
  return Boolean(entry.memory.standing_opt_in
    && entry.memory.activation_policy === "relationship_contextual");
}

function recallRoleFor(entry, tier) {
  const memory = entry.memory;
  if (entry.semanticBackground) return "ambient";
  if (!entry.rawDirectEvidence
    && memory.standing_opt_in
    && memory.activation_policy === "relationship_contextual") return "ambient";
  if (memory.kind === "intimate-agreement" || memory.load_policy === "manifest-always") return "policy";
  if (tier === "T0") return "factual";
  if (tier === "T2") return "associative";
  if (tier === "T1") return "supporting";
  return null;
}

function evidenceTypeFor(tier, role) {
  if (!tier) return null;
  if (role === "ambient") return "ambient_context";
  if (role === "policy") return "policy_context";
  if (tier === "T0") return "direct_fact";
  if (tier === "T2") return "association";
  return "related_context";
}

function recallReasonFor(entry, tier, role) {
  if (!tier) return "insufficient evidence for progressive recall";
  if (role === "ambient") return "standing ambient context may naturally accompany the current exchange";
  if (tier === "T0") return "the current query directly matches this memory";
  if (tier === "T2") return `second-hop association from ${entry.associationSeedId || "a relevant memory"}`;
  if (entry.semanticDecision) return "Decision Model selects relevant supporting context";
  if (entry.vectorEvidence) return "semantic evidence makes this memory relevant in one hop";
  if (entry.situationEvidence) return "situation evidence makes this memory relevant in one hop";
  if (entry.contextualMatch) return "the trusted context envelope makes this memory relevant in one hop";
  return "the memory is related to the current query without another memory bridge";
}

function recallPathFor(entry, tier) {
  const title = entry.memory.title;
  if (!tier) return ["query", "unqualified", title];
  if (tier === "T0") return ["query", "direct match", title];
  if (tier === "T2") {
    return [
      "query",
      entry.associationSeedTitle || entry.associationSeedId || "relevant memory",
      entry.associationBridge || "semantic association",
      title,
    ];
  }
  if (entry.contextualMatch) return ["query", "soft anchor / context envelope", title];
  if (entry.situationEvidence) return ["query", "situation context", title];
  if (entry.vectorEvidence) return ["query", "vector semantic relevance", title];
  return ["query", "related memory", title];
}

function sourceChannelsFor(entry) {
  const channels = ["formal"];
  if (entry.semanticDecision) channels.push("jev");
  if (entry.lexicalBoost > 0) channels.push("fts");
  if (entry.contextualMatch) channels.push("context-envelope");
  if (entry.situationEvidence) channels.push("situation");
  if (entry.vectorEvidence) channels.push("vector");
  if (entry.associationQualified) channels.push("association");
  return [...new Set(channels)];
}
