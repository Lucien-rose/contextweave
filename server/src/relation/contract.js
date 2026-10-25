import { z } from "zod/v4";
import { arcContext } from "../arc/contract.js";
import { namespaceSchema } from "../entity/contract.js";

const id = z.string().trim().min(1).max(240);
const date = z.iso.date();
export const nodeSchema = z.object({ type: z.enum(["memory", "source", "entity"]), id }).strict();
export const relationTypeSchema = z.enum(["references", "participates_in", "explicitly_influences", "contradicts"]);
const status = z.enum(["proposed", "accepted", "disputed", "withdrawn"]);
const evidenceSchema = z.object({
  type: z.enum(["memory", "source"]), id,
  content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  excerpt: z.string().min(1).max(2000),
  start: z.number().int().min(0).optional(),
}).strict();
export const relationProposeSchema = z.object({
  namespace: namespaceSchema.default("real"), from: nodeSchema, to: nodeSchema,
  type: relationTypeSchema,
  explanation: z.string().trim().min(1).max(400),
  evidence: z.array(evidenceSchema).min(1).max(8),
  sensitivity: z.enum(["private", "intimate"]).default("private"),
  pin_endpoints: z.boolean().default(false),
  valid_from: date.nullable().default(null), valid_until: date.nullable().default(null),
}).strict();
export const relationReadSchema = z.object({ relation_id: id, ...arcContext,
  namespace: namespaceSchema.default("real"), query: z.string().max(4000).default(""),
}).strict();
export const relationReviewSchema = z.object({
  relation_id: id, expected_updated_at: z.iso.datetime(),
  status: status.exclude(["proposed"]), reason: z.string().trim().min(1).max(400),
}).strict();
export const relationListSchema = relationReadSchema.omit({ relation_id: true }).extend({
  node: nodeSchema, status: status.or(z.literal("all")).default("all"),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).max(10000).default(0),
});
export const relationPathsSchema = relationReadSchema.omit({ relation_id: true }).extend({
  seed: nodeSchema, direction: z.enum(["outgoing", "incoming", "both"]).default("both"),
  target: nodeSchema.optional(),
  types: z.array(relationTypeSchema).min(1).max(4).default(["references", "participates_in", "explicitly_influences", "contradicts"]),
  as_of: date.nullable().default(null),
  max_hops: z.number().int().min(1).max(2).default(2),
  max_nodes: z.number().int().min(2).max(32).default(24),
  max_paths: z.number().int().min(1).max(20).default(8),
  context_budget_chars: z.number().int().min(1200).max(16000).default(6000),
});

const selectedStep = z.object({ relation_id: id, traversal: z.enum(["forward", "reverse"]),
  updated_at: z.iso.datetime(), evidence_fingerprint: z.string().regex(/^[a-f0-9]{64}$/) });
export const relationBundleSchema = relationReadSchema.omit({ relation_id: true }).extend({
  paths: z.array(z.object({ seed: nodeSchema, steps: z.array(selectedStep).min(1).max(2) })).min(1).max(20),
  as_of: date.nullable().default(null),
  context_budget_chars: z.number().int().min(1200).max(32000).default(12000),
});
