import { relevantChunk } from "./chunks.js";

export function associationContext(entry, runtime, inspected) {
  if (!entry.associationEvidence) return null;
  const seed = inspected.get(entry.associationSeedId);
  if (!seed) return null;
  const query = runtime.queryContext.rawQuery;
  const raw = runtime.queryContext.scoreMemory(seed, query);
  const vector = runtime.vectorById.get(seed.id);
  const window = relevantChunk(seed.content, query, runtime.envelope, 400);
  return {
    seed: {
      id: seed.id, content_hash: seed.content_hash, updated_at: seed.updated_at,
      title: seed.title.slice(0, 160), snippet: window.content,
      query_evidence: {
        lexical: { score: raw.score, matches: (raw.matches || []).slice(0, 12) },
        fts_rank: runtime.ftsShadowRanks.get(seed.id) ?? null,
        vector: vector ? { similarity: vector.similarity, qualified: Boolean(vector.qualified) } : null,
        entity_match: Boolean(runtime.entityMatches.get(seed.id)?.length),
      },
    },
    bridge: { cue: entry.associationBridge, similarity: entry.associationSimilarity,
      threshold: entry.associationThreshold },
  };
}

export function associationDecision(entry, decision) {
  if (!entry.associationEvidence) return null;
  if (decision?.coverage === "deferred") return "association-path-deferred";
  if (!decision) return "association-path-unjudged";
  if (decision.path_fit !== "coherent") return `association-path-${decision.path_fit || "unjudged"}`;
  if (!["material", "background"].includes(decision.answer_utility)) return "association-no-answer-utility";
  return null;
}

export function guardAssociations(scored, observed, decisions, trace) {
  const entries = new Map([...scored, ...observed.map(row => row.entry)]
    .filter(entry => entry.associationEvidence).map(entry => [entry.memory.id, entry]));
  const blocked = new Set();
  for (const candidate of trace) {
    const entry = entries.get(candidate.id);
    if (!entry) continue;
    const decision = decisions?.get(candidate.id);
    const reason = associationDecision(entry, decision);
    candidate.association_judgment = { path_fit: decision?.path_fit || "unjudged",
      answer_utility: decision?.answer_utility || "unjudged" };
    if (!reason) continue;
    blocked.add(candidate.id);
    candidate.admission = "suppress";
    candidate.reason = reason;
  }
  return scored.filter(entry => !blocked.has(entry.memory.id));
}
