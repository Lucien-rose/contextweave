import { z } from "zod/v4";
import { sourceSchema } from "../evolution/contract.js";

export const capsuleDataSchema = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(6000),
  decisions: z.array(z.string().min(1).max(1000)).max(12),
  open_items: z.array(z.object({ id: z.string().min(1).max(160), text: z.string().min(1).max(1000),
    status: z.enum(["open", "blocked", "done"]) }).strict()).max(20),
}).strict();
export const publishCapsuleSchema = z.object({
  change_id: z.string().min(1).max(240),
  window_id: z.string().min(1).max(240),
  source_surface: z.string().min(1).max(100),
  session_id: z.string().min(1).max(240),
  source_revision: z.number().int().min(1),
  expected_version: z.number().int().min(0),
  sensitivity: z.enum(["private", "sensitive", "intimate"]).default("private"),
  data: capsuleDataSchema,
  source_refs: z.array(sourceSchema).min(1).max(20),
}).strict();
export const capsuleReadSchema = z.object({
  capsule_id: z.string().min(1).max(240),
  context: z.enum(["general", "private", "intimate"]).default("private"),
  intimacy_mode: z.enum(["off", "proactive", "scene"]).default("off"),
}).strict();
export const capsuleCatalogSchema = capsuleReadSchema.omit({ capsule_id: true }).extend({
  source_surface: z.string().min(1).max(100).optional(),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0),
});
