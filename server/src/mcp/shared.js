import { ownerMemoryCard } from "../memory-card.js";
import { RECALL_CONTROL_MODES, RECALL_CONTROL_SOURCES } from "../recall/control.js";
import { INTIMACY_MODES } from "../recall/modes.js";
import { z } from "zod/v4";
import { namespaceSchema } from "../entity/contract.js";

export { z };

export const contextSchema = z.enum(["general", "private", "intimate"]);
export const intimacyModeSchema = z.enum(INTIMACY_MODES);
export const familyPolicySchema = z.enum(["representative", "allow-distinct"]);
export const recallControlSchema = z.object({
  mode: z.enum(RECALL_CONTROL_MODES).default("normal"),
  source: z.enum(RECALL_CONTROL_SOURCES).default("conversation"),
}).strict();
export const contextEnvelopeSchema = z.object({
  entity_namespace: namespaceSchema.optional().describe("Explicit identity scope, e.g. real or fiction:work:branch. Defaults to real; never inferred from similar names."),
  speech_act: z.string().max(80).optional(),
  action_phase: z.string().max(80).optional(),
  entities: z.array(z.string().min(1).max(120)).max(12).default([]),
  topics: z.array(z.string().min(1).max(120)).max(12).default([]),
  state_cues: z.array(z.string().min(1).max(120)).max(12).default([]),
  recall_hypotheses: z.array(z.string().min(1).max(500)).max(3).default([])
    .describe("Up to three open semantic retrieval hypotheses. For indirect recommendations or broad preference questions, describe decision-relevant preference/constraint categories and representative world-knowledge examples without naming a guessed stored memory."),
});

export function result(structuredContent) {
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

export function compactDiagnosticTrace(trace) {
  const candidates = trace.candidates.filter((candidate) =>
    candidate.final
    || candidate.admission !== "reject"
    || candidate.candidate_sources.includes("fts-shadow")
    || candidate.candidate_sources.includes("situation-shadow")
    || candidate.candidate_sources.includes("vector")
    || candidate.candidate_sources.includes("association"));
  return {
    ...trace,
    diagnostic_candidate_count: candidates.length,
    candidates,
  };
}

export function errorResult(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function stripInternal(memory) {
  return ownerMemoryCard(memory);
}

export function gallerySummary(item) {
  const {
    tags_json, storage_name, original_file_name, mime_type,
    byte_length, content_hash, image_url, sort_order, ...safe
  } = item;
  return safe;
}
