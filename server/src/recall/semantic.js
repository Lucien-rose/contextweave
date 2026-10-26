export function applySemanticDecisions(observed, baseline, decisions) {
  const local = new Map(baseline.map(entry => [entry.memory.id, entry]));
  const selected = [];
  for (const { entry, formalAllowed } of observed) {
    const id = entry.memory.id;
    const decision = decisions.get(id);
    if ((entry.rawDirectEvidence && local.has(id)) || !decision || decision.relevance === "uncertain" || decision.context_fit === "uncertain") {
      if (local.has(id)) selected.push(local.get(id));
      continue;
    }
    if (decision.relevance !== "useful" || decision.use === "omit" || decision.context_fit === "inappropriate") continue;
    selected.push({ ...entry, semanticDecision: true, semanticPriority: decision.priority,
      semanticBackground: !formalAllowed || decision.use === "background" });
  }
  return selected.sort((a, b) => Number(b.rawDirectEvidence) - Number(a.rawDirectEvidence)
    || (b.semanticPriority || 0) - (a.semanticPriority || 0) || a.memory.id.localeCompare(b.memory.id));
}
