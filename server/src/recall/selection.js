import { defaults } from "../defaults.js";
import { applyVerifyAuthority, resolveVerifyPlan } from "./verify-plan.js";
import { applyAnswerAuthority, resolveAnswerAuthority, selectAnswerAuthorityRepresentatives } from "./answer-authority.js";
import { annotateTraceSemantics, assignRecallSemantics, compareTiered, progressivePresentation } from "./tiering.js";
import { compareActivatedScored } from "./ranking.js";
import { recommendedMode, summarize } from "./presentation.js";
import { isBackgroundEntry, selectBackground } from "./background.js";
import { annotatePackingTrace, selectByRecallBudget } from "./packing.js";
import { boundRecallLanes, serializedChars } from "./response-budget.js";

// Baseline and shadow share authority, family selection and both output budgets.
export function selectRecallCandidates(repository, entries, traceCandidates, runtime, {
  query, context, intimacyMode, familyPolicy = "representative", limit = defaults.recallItems,
  contextBudgetChars = defaults.mainChars, backgroundLimit = defaults.backgroundItems, backgroundBudgetChars = defaults.backgroundChars,
  totalBudgetChars,
  compareWithinTier = compareActivatedScored,
} = {}) {
  const verifyPlan = resolveVerifyPlan(query, entries);
  let scored = applyVerifyAuthority(entries, traceCandidates, verifyPlan);
  const authority = resolveAnswerAuthority(repository, scored, runtime.recallPlan);
  if (familyPolicy !== "allow-distinct" && runtime.recallPlan.state_scope !== "current-and-history") {
    const { selected, suppressed } = selectAnswerAuthorityRepresentatives(scored, authority);
    for (const candidate of traceCandidates) {
      if (suppressed.has(candidate.id)) {
        candidate.admission = "suppress";
        candidate.reason = suppressed.get(candidate.id);
      }
    }
    scored = selected;
  }
  scored = applyAnswerAuthority(assignRecallSemantics(scored), authority);
  annotateTraceSemantics(traceCandidates, scored);
  scored = scored.filter((entry) => entry.recallQualified)
    .sort((a, b) => compareTiered(a, b, (left, right) =>
      (right.semanticPriority || 0) - (left.semanticPriority || 0) || compareWithinTier(left, right)));
  const ranks = new Map(scored.map((entry, index) => [entry.memory.id, index + 1]));
  for (const candidate of traceCandidates) candidate.rank_before_budget = ranks.get(candidate.id) || null;
  const queryContext = runtime.queryContext;
  const present = (entry, memberships = []) => progressivePresentation({ ...entry, readingQuery: query, readingEnvelope: runtime.envelope }, summarize(entry.memory, entry.score, {
      matchReason: entry.matchReason, recommendedMode: recommendedMode(entry.memory, query),
      alreadyRecentlyRead: false, arcMemberships: memberships,
      entities: runtime.entityMatches.get(entry.memory.id) || [],
      navigation: { query, context, intimacyMode, namespace: queryContext.contextEnvelope?.entity_namespace,
        asOf: queryContext.facets?.temporal?.as_of },
    }));
  const prepared = scored.map((entry) => ({ entry, presentation: present(entry) }));
  const background = selectBackground(prepared.filter(({ entry }) => isBackgroundEntry(entry)), {
    maxItems: backgroundLimit, charBudget: backgroundBudgetChars,
  });
  const budget = selectByRecallBudget(prepared.filter(({ entry }) => !isBackgroundEntry(entry)), {
    maxItems: limit, charBudget: contextBudgetChars,
    presentSelected(entries) {
      const arcs = repository.arcs(entries.map(({ memory }) => memory), { context, intimacyMode });
      return new Map(entries.map((entry) => [entry.memory.id, present(entry, arcs.get(entry.memory.id) || [])]));
    },
  });
  const originalPresentations = new Map([...budget.selected, ...background.selected]
    .map((item) => [item.entry.memory.id, item.presentation]));
  const hardBudget = boundRecallLanes(budget.selected, background.selected, { limit: totalBudgetChars, query });
  budget.selected = hardBudget.main;
  background.selected = hardBudget.background;
  budget.selectedChars = budget.selected.reduce((sum, item) => sum + serializedChars(item.presentation), 0);
  background.selectedChars = background.selected.reduce((sum, item) => sum + serializedChars(item.presentation), 0);
  budget.totalLimit = hardBudget.limit;
  budget.totalSelectedChars = hardBudget.used;
  for (const id of hardBudget.dropped) {
    const decisions = budget.decisions.has(id) ? budget.decisions : background.decisions;
    decisions.set(id, { presentation_chars: 0, presentation_mode: "omitted", packing_decision: "total-budget-or-duplicate" });
    if (budget.decisions.has(id)) budget.skippedIds.push(id);
  }
  for (const item of [...budget.selected, ...background.selected]) {
    const id = item.entry.memory.id;
    if (item.presentation === originalPresentations.get(id)) continue;
    const decisions = budget.decisions.has(id) ? budget.decisions : background.decisions;
    decisions.set(id, { presentation_chars: serializedChars(item.presentation),
      presentation_mode: "compact", packing_decision: "total-compacted" });
  }
  annotatePackingTrace(traceCandidates, budget);
  annotatePackingTrace(traceCandidates, background);
  const memories = budget.selected.map(({ presentation }) => presentation);
  const backgroundMemories = background.selected.map(({ presentation }) => presentation);
  const selected = [...budget.selected, ...background.selected].map(({ entry }) => entry);
  const finalIds = new Set(selected.map(({ memory }) => memory.id));
  for (const candidate of traceCandidates) candidate.final = finalIds.has(candidate.id);
  return { memories, backgroundMemories, selected, budget, background, verifyPlan };
}
