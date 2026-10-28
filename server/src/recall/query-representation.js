import { createEvidenceScorer } from "./evidence.js";
import { z } from "zod/v4";
import { namespaceSchema } from "../entity/contract.js";
import { parseContract } from "../lib/contract.js";
import { normalizeContextEnvelope } from "./context.js";
import { analyzeRecallQuery } from "./query-focus.js";
import { isTechnicalTask } from "./admission.js";
import { resolveHistoricalRoute } from "./history-plan.js";
import { semanticSituationMayUnlockBody } from "./disclosure.js";

const facet = z.string().trim().min(1).max(120);
const facets = z.array(facet).max(12).default([]);
export const queryRepresentationSchema = z.object({
  speech_act: z.string().max(80).optional(),
  action_phase: z.string().max(80).optional(),
  task_intent: z.string().max(120).optional(),
  domain_intent: z.string().max(120).optional(),
  entity_namespace: namespaceSchema.optional(),
  entities: facets,
  aliases: facets,
  topics: facets,
  preferences: facets,
  emotional_facets: facets,
  state_cues: facets,
  temporal: z.object({
    state_scope: z.enum(["current", "historical", "current-and-history"]).optional()
      .describe("Time of the requested events or facts; historical does not imply a superseded memory revision."),
    version_scope: z.enum(["active", "superseded", "all"]).optional()
      .describe("Memory revision lifecycle, independent of event time. Use superseded only when the user requests a replaced version."),
    as_of: z.iso.date().optional(),
  }).strict().optional(),
  recall_hypotheses: z.array(z.string().trim().min(1).max(500)).max(3).default([]),
}).strict();

export function prepareQueryContext(query, representation, contextEnvelope) {
  const provided = representation != null;
  const facets = provided ? parseContract(queryRepresentationSchema, representation) : null;
  const legacy = contextEnvelope || {};
  const combined = facets ? {
    ...legacy,
    ...facets,
    entities: [...new Set([...(legacy.entities || []), ...facets.entities])].slice(0, 12),
    topics: [...new Set([...(legacy.topics || []), ...facets.topics, ...facets.aliases,
      ...facets.preferences, ...facets.emotional_facets, facets.task_intent, facets.domain_intent].filter(Boolean))].slice(0, 12),
    state_cues: [...new Set([...(legacy.state_cues || []), ...facets.state_cues])].slice(0, 12),
    recall_hypotheses: [...new Set([...(legacy.recall_hypotheses || []), ...facets.recall_hypotheses])].slice(0, 3),
  } : contextEnvelope;
  const recallPlan = resolveHistoricalRoute(query);
  const scope = facets?.temporal?.state_scope;
  const versionScope = facets?.temporal?.version_scope;
  const plan = !recallPlan.historical_intent && (versionScope || (scope && scope !== "current"))
    ? { ...recallPlan, event_scope: scope || "current",
        state_scope: versionScope === "superseded" ? "historical"
          : versionScope === "all" ? "current-and-history" : recallPlan.state_scope,
        historical_reference: true, historical_intent: ["superseded", "all"].includes(versionScope),
        compare_current: versionScope === "all",
        candidate_statuses: versionScope === "superseded" ? ["superseded"]
          : versionScope === "active" ? ["active"] : ["active", "superseded"],
        reason: "host-inferred-temporal-scope" }
    : recallPlan;
  return {
    rawQuery: String(query || ""), provided, facets, contextEnvelope: combined, scoreMemory: createEvidenceScorer(),
    envelope: normalizeContextEnvelope(combined),
    queryFocus: analyzeRecallQuery(query),
    technicalIntent: isTechnicalTask(query),
    mayUnlockBody: semanticSituationMayUnlockBody(query),
    recallPlan: plan,
  };
}

export function queryContextTrace(prepared) {
  return {
    schema_version: "query-representation-v1", provided: prepared.provided,
    authority_source: "raw-utterance", derived_source: prepared.provided ? "host-inferred" : "legacy-envelope",
    entity_count: prepared.envelope.entities.length,
    topic_count: prepared.envelope.topics.length,
    hypothesis_count: prepared.envelope.hypothesisCount,
    temporal_scope: prepared.recallPlan.state_scope,
    event_scope: prepared.facets?.temporal?.state_scope || "current",
    graph_expansion: "explicit-tool-only",
  };
}

