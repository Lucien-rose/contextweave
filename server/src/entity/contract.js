import { z } from "zod/v4";
import { INTIMACY_MODES } from "../recall/modes.js";

const id = z.string().trim().min(1).max(240);
const contextSchema = z.enum(["general", "private", "intimate"]);
const intimacyModeSchema = z.enum(INTIMACY_MODES);
export const namespaceSchema = z.string().trim().min(1).max(160).regex(/^[a-z0-9][a-z0-9:._/-]*$/);
export const entityWriteSchema = z.object({
  entity_id: id.optional(),
  type: z.enum(["person", "pet", "place", "project", "symbol", "other"]),
  display_name: z.string().trim().min(1).max(160),
  aliases: z.array(z.string().trim().min(1).max(160)).max(30).optional(),
  sensitivity: z.enum(["private", "intimate"]).optional(),
  namespace: namespaceSchema.optional(),
}).strict();
export const entityReadSchema = z.object({
  entity_id: id, context: contextSchema.default("general"),
  intimacy_mode: intimacyModeSchema.default("off"),
  namespace: namespaceSchema.default("real"),
}).strict();
export const entityListSchema = entityReadSchema.omit({ entity_id: true }).extend({
  query: z.string().max(4000).default(""),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0),
});
export const entityLinkSchema = z.object({
  entity_id: id, memory_id: id, linked: z.boolean().default(true),
}).strict();
