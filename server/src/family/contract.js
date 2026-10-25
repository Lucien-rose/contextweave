import { z } from "zod/v4";

const id = z.string().min(1).max(240);
export const familyReadSchema = z.object({ family_key: z.string().min(1).max(160) }).strict();
export const familyGroupSchema = familyReadSchema.extend({
  expected_fingerprint: z.string().min(1),
  groups: z.array(z.array(id).min(1).max(200)).min(1).max(200),
}).strict();
export const familyJudgeSchema = familyReadSchema.extend({ memory_id: id.optional(), refresh: z.boolean().optional() }).strict();
