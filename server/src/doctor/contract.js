import { defaults } from "../defaults.js";
import { z } from "zod/v4";
import { batchInputFields, validateBatch } from "../processing/input.js";
import { writerProposalSchema } from "../portrait/runtime-contract.js";
import { changeExplanationSchema } from "../family/history.js";

export const doctorBatchSchema = z.object({
  ...batchInputFields,
  batch_id: z.string().min(1).max(160),
  memory_ids: z.array(z.string().min(1).max(240)).max(20).default([]),
}).strict().superRefine(validateBatch);
export const doctorProposalSchema = writerProposalSchema.extend({
  family_changes: z.array(z.object({
    target_memory_id: z.string().min(1).max(240),
    operation: z.enum(["reinforce", "supersede", "coexist", "correct"]),
    title: z.string().min(1).max(160), content: z.string().min(1).max(3000),
    change_explanation: changeExplanationSchema,
    evidence: writerProposalSchema.shape.memory_candidates.element.shape.evidence,
  }).strict()).max(defaults.memoryCandidates),
}).superRefine((value, ctx) => {
  if (value.memory_candidates.length + value.family_changes.length > defaults.memoryCandidates) {
    ctx.addIssue({ code: "custom", message: `Memory and Lineage proposals share a ${defaults.memoryCandidates}-candidate budget` });
  }
});
