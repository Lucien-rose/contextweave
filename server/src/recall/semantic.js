import { associationDecision } from "./association-context.js";

export function directAnswerDisposition(entry, decision) {
  if (!entry.rawDirectEvidence) return null;
  if (!decision) return "unjudged";
  return ["material", "background", "none", "uncertain"].includes(decision.answer_utility)
    ? decision.answer_utility : "unjudged";
}

export function applySemanticDecisions(observed, baseline, decisions) {
  const local = new Map(baseline.map(entry => [entry.memory.id, entry]));
  const selected = [];
  for (const { entry, formalAllowed } of observed) {
    const id = entry.memory.id;
    const decision = decisions.get(id);
    if (associationDecision(entry, decision)) continue;
    if (entry.rawDirectEvidence && local.has(id)) {
      const disposition = directAnswerDisposition(entry, decision);
      if (disposition === "none") continue;
      selected.push(["unjudged", "uncertain"].includes(disposition) ? local.get(id) : { ...local.get(id),
        semanticDecision: true, semanticPriority: decision.priority,
        semanticBackground: disposition === "background" });
      continue;
    }
    if (!decision) continue;
    if (decision.relevance === "uncertain" || decision.context_fit === "uncertain") continue;
    if (decision.relevance !== "useful" || decision.use === "omit" || decision.context_fit === "inappropriate") continue;
    selected.push({ ...entry, semanticDecision: true, semanticPriority: decision.priority,
      semanticBackground: !formalAllowed || decision.use === "background" || decision.answer_utility === "background" });
  }
  return selected.sort((a, b) => Number(b.rawDirectEvidence) - Number(a.rawDirectEvidence)
    || (b.semanticPriority || 0) - (a.semanticPriority || 0) || a.memory.id.localeCompare(b.memory.id));
}
