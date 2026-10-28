import { z } from "zod/v4";
import { RECALL_CONTROL_MODES, RECALL_CONTROL_SOURCES } from "./control.js";
import { INTIMACY_MODES } from "./modes.js";
import { namespaceSchema } from "../entity/contract.js";
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
