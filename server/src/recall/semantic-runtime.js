import { randomUUID } from "node:crypto";
import { getMemory } from "../database.js";
import { buildJevSnapshot } from "./jev-snapshot.js";
import { jevConfig, judgeJevCandidates } from "./jev-provider.js";
import { recallMemoriesWithTrace } from "./pipeline.js";

export async function runSemanticRecall(db, input, baseline, dependencies = {}) {
  const requested = input.jevMode ?? process.env.CW_JEV_MODE ?? process.env.MOSS_RECALL_JEV_MODE;
  if (requested != null && !["off", "observe", "on"].includes(requested)) throw new TypeError("Invalid Jev mode");
  if (requested === "off" || input.recallControl?.mode === "no_recall") return baseline(input);
  let config, configFailed = false;
  try { config = dependencies.config || jevConfig({ task: "recall_judge" }); }
  catch { config = { available: false }; configFailed = true; }
  const mode = requested || (config.available || configFailed ? "on" : "off");
  if (mode === "off") return baseline(input);
  const status = { mode, recall_path: "local", jev_status: configFailed ? "configuration-unavailable" : "not-configured", fallback_used: mode === "on" };
  const deliver = result => {
    // The host callback is deliberately outside the serializable model response.
    input.onRecallStatus?.({ ...status });
    return result;
  };
  if (!config.available) return deliver(await baseline(input));
  let captured;
  const prepared = await baseline({ ...input, recordRecall: false,
    captureCandidates: value => { captured = value; } });
  if (!captured) return deliver(prepared);
  const runtime = captured.runtime;
  const finish = semanticDecisions => recallMemoriesWithTrace(runtime.repository, {
    ...input, preparedQuery: runtime.queryContext, vectorRecall: runtime.vectorResult,
    associationRecall: runtime.associationResult, semanticDecisions });
  const snapshot = buildJevSnapshot(captured, prepared, input);
  let decisions = null;
  if (!snapshot.rows.length) {
    Object.assign(status, { jev_status: "no-candidates", fallback_used: false });
    return deliver(finish(null));
  }
  if (mode === "on" && snapshot.coverage.baseline_truncated_count > 0) {
    Object.assign(status, { jev_status: "snapshot-incomplete", fallback_used: true });
    return deliver(finish(null));
  }
  try {
    const judged = await (dependencies.judge || judgeJevCandidates)(snapshot, { config, fetchImpl: dependencies.fetchImpl, requireComplete: true });
    if (!snapshot.rows.every(({ entry }) => {
      const current = getMemory(db, entry.memory.id);
      return current && current.content_hash === entry.memory.content_hash && current.updated_at === entry.memory.updated_at;
    })) throw new Error("stale-snapshot");
    decisions = new Map(judged.decisions.map(decision => [decision.candidate_id, decision]));
    Object.assign(status, { recall_path: mode === "on" ? "jev" : "local", jev_status: mode === "on" ? "applied" : "observed", fallback_used: false });
  } catch (error) {
    Object.assign(status, { jev_status: error.message === "stale-snapshot" ? "stale-snapshot"
      : error.name === "TimeoutError" ? "timeout" : "provider-failed", incident_id: randomUUID() });
    decisions = null;
    status.fallback_used = mode === "on";
  }
  return deliver(finish(mode === "on" ? decisions : null));
}
