import { getMemory } from "../database.js";
import { progressiveRecall } from "./sqlite.js";
import { buildJevSnapshot } from "./jev-snapshot.js";
import { JEV_PROMPT_VERSION, jevConfig, jevIdentity, judgeJevCandidates } from "./jev-provider.js";
import { selectRecallCandidates } from "./selection.js";
import { compareMemoryIds } from "./ranking.js";

// Explicit diagnostics only. No model output enters the ordinary recall path.
export async function recallWithJevShadow(db, input = {}, dependencies = {}) {
  const started = performance.now();
  const config = dependencies.config || jevConfig();
  const enabled = input.jevShadowMode === "observe";
  const report = { schema_version: "jev-shadow-v1", mode: enabled ? "observe" : "off",
    activated: false, answer_authority_granted: false, status: "off", baseline_release: "0.9.3-rc.3.37" };
  let captured;
  const diagnostic = await progressiveRecall(db, { ...input, jevMode: "off", recordRecall: false, syncIndex: false,
    captureCandidates: enabled && config.available ? (value) => { captured = value; } : null });
  if (!enabled) return diagnostic;
  const shadowStart = performance.now();
  if (input.recallControl?.mode === "no_recall") report.status = "suppressed-by-recall-control";
  else if (!config.available) report.status = "not-configured";
  else {
    const snapshot = buildJevSnapshot(captured, diagnostic, input);
    Object.assign(report, { snapshot_fingerprint: snapshot.fingerprint, coverage: snapshot.coverage,
      provider_identity: jevIdentity(config), prompt_version: JEV_PROMPT_VERSION });
    if (!snapshot.rows.length) report.status = "no-candidates";
    else {
      const providerStart = performance.now();
      try {
        const judged = await judgeJevCandidates(snapshot, { ...dependencies, config });
        report.provider_ms = elapsed(providerStart);
        if (!snapshot.rows.every(({ entry }) => unchanged(db, entry.memory))) throw new Error("jev-stale-snapshot");
        const decisions = new Map(judged.decisions.map((decision) => [decision.candidate_id, decision]));
        const simulated = simulateSelection(db, input, captured, snapshot, diagnostic, decisions);
        Object.assign(report, { status: "observed", usage: judged.usage, resolved_model: judged.resolvedModel,
          decisions: snapshot.rows.map(({ candidate, baselineReason, baselineSelected }) => ({
            candidate_id: candidate.candidate_id, baseline_reason: baselineReason,
            baseline_selected: baselineSelected,
            decision: decisions.get(candidate.candidate_id) || null,
          })),
          comparison: compareSelections(diagnostic, simulated, snapshot, decisions) });
      } catch (error) {
        report.provider_ms = elapsed(providerStart);
        // Never echo provider bodies, validation snippets, credentials or queries.
        report.status = error.message === "jev-stale-snapshot" ? "stale-snapshot" : "provider-failed";
        report.failure_code = /^jev-(?:http-\d{3}|invalid-decision-answer|stale-snapshot)$/.test(error.message)
          ? error.message : error.name === "TimeoutError" ? "jev-timeout" : "jev-invalid-or-failed-response";
      }
    }
  }
  report.latency_ms = elapsed(shadowStart);
  diagnostic.trace.jev_shadow = report;
  diagnostic.trace.request_phases_ms.jev_shadow = report.latency_ms;
  diagnostic.trace.request_latency_ms = elapsed(started);
  return diagnostic;
}

function simulateSelection(db, input, captured, snapshot, baseline, decisions) {
  const oldIds = new Set(baseline.trace.final_ids);
  const candidates = new Map(snapshot.rows.map(({ candidate }) => [candidate.candidate_id, candidate]));
  const selected = [];
  for (const { entry } of captured.entries) {
    const id = entry.memory.id;
    const decision = decisions.get(id);
    if (entry.rawDirectEvidence) {
      if (oldIds.has(id)) selected.push(entry);
      continue;
    }
    const candidate = candidates.get(id);
    const uncertain = !decision || decision.relevance === "uncertain"
      || (candidate?.context_check && decision.context_fit === "uncertain");
    if (!candidates.has(id) || uncertain) {
      if (oldIds.has(id)) selected.push(entry);
      continue;
    }
    if (decision.relevance !== "useful" || decision.use === "omit"
      || (candidate.context_check && decision.context_fit !== "appropriate")) continue;
    selected.push({ ...entry, semanticDecision: true, semanticPriority: decision.priority });
  }
  const compare = (a, b) => Number(b.rawDirectEvidence) - Number(a.rawDirectEvidence)
    || (Number(b.semanticPriority) || 0) - (Number(a.semanticPriority) || 0)
    || compareMemoryIds(a.memory, b.memory);
  return selectRecallCandidates(captured.runtime.repository, selected.sort(compare), [], captured.runtime,
    { ...input, compareWithinTier: compare });
}

function compareSelections(baseline, simulated, snapshot, decisions) {
  const before = baseline.trace.final_ids;
  const after = [...simulated.memories, ...simulated.backgroundMemories].map((memory) => memory.id);
  const old = new Set(before);
  const next = new Set(after);
  const rows = snapshot.rows;
  return { baseline_main_ids: baseline.memories.map((item) => item.id),
    baseline_background_ids: baseline.background_memories.map((item) => item.id),
    simulated_main_ids: simulated.memories.map((item) => item.id),
    simulated_background_ids: simulated.backgroundMemories.map((item) => item.id),
    added_ids: after.filter((id) => !old.has(id)), omitted_ids: before.filter((id) => !next.has(id)),
    abstained_ids: rows.filter(({ candidate }) => {
      const decision = decisions.get(candidate.candidate_id);
      return !decision || decision.relevance === "uncertain"
        || (candidate.context_check && decision.context_fit === "uncertain");
    }).map(({ candidate }) => candidate.candidate_id),
    pool_missing_baseline_ids: before.filter((id) => !rows.some((row) => row.entry.memory.id === id)),
    simulated_main_chars: simulated.budget.selectedChars,
    simulated_background_chars: simulated.background.selectedChars,
    interpretation: "suggestions-only; differences are not ground-truth quality scores" };
}

function unchanged(db, memory) {
  const current = getMemory(db, memory.id);
  return current && current.content_hash === memory.content_hash && current.version === memory.version
    && current.status === memory.status && current.updated_at === memory.updated_at;
}

function elapsed(start) {
  return Math.round((performance.now() - start) * 100) / 100;
}
