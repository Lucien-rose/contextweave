import { z } from "zod/v4";
import { defaults } from "../defaults.js";
import { recallScopeSchema } from "./cooldown.js";
import { queryRepresentationSchema } from "./query-representation.js";
import { recallResponse } from "./response.js";
import { contextSchema, intimacyModeSchema, familyPolicySchema, contextEnvelopeSchema, recallControlSchema } from "./context-contract.js";

export const bootstrapRequestSchema = z.object({
  current_message: z.string().max(4000).optional().describe("The user's current message, used only to rank core memories."),
  delivery_mode: z.enum(["immediate", "confirmed"]).default("immediate"),
  context: contextSchema.default("general").describe("Current conversational sensitivity context."),
  intimacy_mode: intimacyModeSchema.default("off").describe("Independent intimate-memory policy for the current conversation."),
  recently_read_ids: z.array(z.string().min(1)).max(100).default([]),
  recently_read_hashes: z.array(z.string().min(1)).max(100).default([]),
  recently_read_families: z.array(z.string().min(1)).max(100).default([]),
  context_envelope: contextEnvelopeSchema.optional()
    .describe("Optional generic situation envelope inferred from the current exchange. It is ephemeral and must not name a guessed memory ID."),
  limit: z.number().int().min(3).max(12).default(8),
  total_budget_chars: z.number().int().min(2048).max(24000).default(defaults.seedChars),
}).strict();

export function performBootstrap(core, {
  current_message = "", context = "general", intimacy_mode = "off",
  recently_read_ids = [], recently_read_hashes = [], recently_read_families = [],
  context_envelope,
  delivery_mode = "immediate",
  total_budget_chars = defaults.seedChars,
}) {
  const bundle = core.bootstrap({
    deliveryMode: delivery_mode,
    query: current_message,
    context,
    intimacyMode: intimacy_mode,
    recentlyReadIds: recently_read_ids,
    recentlyReadHashes: recently_read_hashes,
    recentlyReadFamilies: recently_read_families,
    contextEnvelope: context_envelope,
    totalBudgetChars: total_budget_chars,
  });
  return bundle;
}

export const recallRequestSchema = z.object({
  query: z.string().min(1).max(4000).describe("The current utterance, kept close to its original wording so subject, task, and technical-intent gates remain authoritative."),
  context: contextSchema.default("general").describe("Use intimate only when the present conversation itself is adult and intimate."),
  intimacy_mode: intimacyModeSchema.default("off"),
  limit: z.number().int().min(1).max(12).default(defaults.recallItems)
    .describe("Elastic recall ceiling. Tiering and context budget decide how many items actually return; this is not a per-tier quota."),
  context_budget_chars: z.number().int().min(1200).max(12000).default(defaults.mainChars)
    .describe("Approximate serialized context budget for returned memories. T0 direct memories are preserved first; T1/T2 use the remaining budget."),
  total_budget_chars: z.number().int().min(2048).max(24000).default(defaults.totalChars)
    .describe("Hard combined response ceiling, including main/background cues and response overhead; direct evidence cannot bypass it."),
  include_archived: z.boolean().default(true),
  delivery_mode: z.enum(["immediate", "confirmed"]).default("immediate")
    .describe("Use confirmed only when the host acknowledges successful context injection with moss_recall_delivered; failed attempts do not count as read."),
  recently_read_ids: z.array(z.string().min(1)).max(100).default([]),
  recently_read_hashes: z.array(z.string().min(1)).max(100).default([]),
  recently_read_families: z.array(z.string().min(1)).max(100).default([]),
  query_representation: queryRepresentationSchema.optional().describe("Host-derived retrieval facets; raw query remains authoritative. Never guess a stored memory ID."),
  background_limit: z.number().int().min(0).max(3).default(defaults.backgroundItems),
  background_budget_chars: z.number().int().min(0).max(4000).default(defaults.backgroundChars),
  cue_neighborhood_mode: z.enum(["off", "observe"]).default("observe"),
  context_envelope: contextEnvelopeSchema.optional()
    .describe("Generic semantic-intent envelope inferred by a trusted pre-response router. Strongly recommended for indirect recommendations, choices, elliptical language, and broad preference questions; describe useful preference/constraint categories and representative examples without guessing a stored memory."),
  recall_control: recallControlSchema.optional()
    .describe("Explicit per-turn memory control from a trusted upstream. Never infer it from ordinary refusal, teasing, emotional language, or intimate dialogue. suppress_situation means the user explicitly asked not to use Context Lens to infer from prior context; no_recall means the user explicitly asked not to retrieve prior memories this turn."),
  family_policy: familyPolicySchema.default("representative"),
  allow_repeat: z.boolean().default(false),
  allow_repeat_if_stale: z.boolean().default(false),
  recall_scope: recallScopeSchema.optional().describe("Host-owned client/surface identity. Only confirmed main-lane delivery starts cooldown; session is audit-only. Omit for legacy behavior."),
  jev_mode: z.enum(["off", "observe", "on"]).optional().describe("on uses semantic judgment, observe retains local results, off disables it. Configured models default to on. Provider failure falls back locally; successful omission is not a failure."),
  vector_mode: z.enum(["off", "observe", "on"]).optional()
    .describe("Optional per-turn vector control for diagnostics or staged rollout. Omit to use server default."),
}).strict();

export async function performRecall(core, {
  query, context = "general", intimacy_mode = "off", limit = defaults.recallItems, context_budget_chars = defaults.mainChars, include_archived = true, delivery_mode = "immediate",
  recently_read_ids = [], recently_read_hashes = [], recently_read_families = [],
  query_representation, background_limit, background_budget_chars, cue_neighborhood_mode,
  context_envelope, recall_control, family_policy = "representative", allow_repeat = false, allow_repeat_if_stale = false,
  recall_scope, jev_mode, vector_mode, total_budget_chars = defaults.totalChars,
}) {
  let hostStatus = null;
  const recalled = await core.recallForDelivery({
    onRecallStatus: status => { hostStatus = status; },
    deliveryMode: delivery_mode,
    query, context, intimacyMode: intimacy_mode, limit, contextBudgetChars: context_budget_chars, includeArchived: include_archived,
    recentlyReadIds: recently_read_ids, recentlyReadHashes: recently_read_hashes,
    recentlyReadFamilies: recently_read_families, familyPolicy: family_policy,
    queryRepresentation: query_representation, backgroundLimit: background_limit,
    backgroundBudgetChars: background_budget_chars, cueNeighborhoodMode: cue_neighborhood_mode,
    contextEnvelope: context_envelope, recallControl: recall_control,
    allowRepeat: allow_repeat, allowRepeatIfStale: allow_repeat_if_stale,
    recallScope: recall_scope, jevMode: jev_mode, vectorMode: vector_mode,
    totalBudgetChars: total_budget_chars,
  });
  return { data: recallResponse(recalled, { query }), hostStatus };
}
