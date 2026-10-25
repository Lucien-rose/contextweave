import { z } from "zod/v4";
import { INTIMACY_MODES } from "../recall/modes.js";

const id = z.string().trim().min(1).max(240);
const title = z.string().trim().min(1).max(200);
const page = {
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).max(1_000_000).default(0),
};
export const arcContext = {
  context: z.enum(["general", "private", "intimate"]).default("general"),
  intimacy_mode: z.enum(INTIMACY_MODES).default("off"),
};
export const arcCreateSchema = z.object({
  title,
  sensitivity: z.enum(["private", "intimate"]).default("private"),
}).strict();
export const arcIdSchema = z.object({ arc_id: id }).strict();
export const arcRenameSchema = arcIdSchema.extend({ title });
export const arcReadSchema = arcIdSchema.extend(arcContext);
export const arcListSchema = z.object({
  ...arcContext, ...page,
  status: z.enum(["active", "archived", "all"]).default("active"),
  query: z.string().trim().max(4000).default(""),
}).strict();
export const arcMaterialRefSchema = arcIdSchema.extend({
  material_type: z.enum(["memory", "family", "handoff", "source"]),
  material_id: id,
});
export const arcAttachSchema = arcMaterialRefSchema.extend({
  chapter: z.string().trim().max(200).default(""),
  position: z.number().int().min(0).max(1_000_000).default(0),
});
export const arcMaterialsSchema = arcReadSchema.extend({
  ...page,
  chapter: z.string().trim().max(200).optional(),
  query: z.string().trim().max(4000).default(""),
});
