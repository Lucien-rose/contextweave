import { z } from "zod/v4";
export { parseContract } from "../lib/contract.js";
import { SEMANTIC_MEMORY_KINDS } from "../memory-kind.js";
import { changeExplanationSchema } from "../family/history.js";

export const sourceContextSchema = z.object({
  content: z.string().min(1).max(50_000),
  speaker: z.string().min(1).max(80).optional(),
  conversation_id: z.string().min(1).max(240).optional(),
  window_id: z.string().min(1).max(240).optional(),
  message_id: z.string().min(1).max(240).optional(),
  occurred_at: z.string().datetime({ offset: true }).optional(),
  written_at: z.string().datetime({ offset: true }).optional(),
  sensitivity: z.enum(["personal", "private", "sensitive", "intimate"]).optional(),
}).strict();

export const sourceSchema = z.object({
  source_type: z.string().min(1).max(80),
  source_id: z.string().min(1).max(240),
  excerpt: z.string().max(2000).optional(),
  occurred_at: z.string().datetime({ offset: true }).optional(),
  written_at: z.string().datetime({ offset: true }).optional(),
  source_hash: z.string().min(1).max(128).optional(),
  material_id: z.string().min(1).max(240).optional(),
  source_context: sourceContextSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const memoryAttributesSchema = z.object({
  layer: z.enum(["core", "context", "archive"]).optional(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tags: z.array(z.string().min(1).max(80)).max(30).optional(),
  triggers: z.array(z.string().min(1).max(120)).max(30).optional(),
  sensitivity: z.enum(["personal", "private", "sensitive", "intimate"]).optional(),
  mentionability: z.enum(["natural", "contextual", "explicit-only"]).optional(),
  importance: z.number().int().min(0).max(100).optional(),
  load_policy: z.enum(["contextual", "deep-rotate", "manifest-always", "explicit-only"]).optional(),
  standing_opt_in: z.boolean().optional(),
  scope: z.enum(["private_general", "private_relationship"]).optional(),
  activation_policy: z.enum(["explicit_trigger", "relationship_contextual", "scene_only"]).optional(),
  egress_policy: z.literal("local_only").optional(),
  safe_projection: z.string().min(1).max(5000).nullable().optional(),
  recall_summary: z.string().min(1).max(5000).nullable().optional(),
  public_projection: z.string().min(1).max(5000).nullable().optional(),
}).strict();

export const intentSchema = z.object({
  change_id: z.string().min(1).max(240),
  operation: z.enum(["create", "reinforce", "supersede", "coexist", "correct", "append_episode"]),
  authority: z.enum(["delegated", "user_correction"]),
  user_instruction: z.string().min(1).max(2000).optional(),
  family_key: z.string().min(1).max(160),
  target_memory_id: z.string().min(1).max(240).optional(),
  expected_content_hash: z.string().min(1).optional(),
  expected_updated_at: z.string().min(1).optional(),
  lifecycle_class: z.enum(["belief", "episode", "protected"]),
  memory_kind: z.enum(SEMANTIC_MEMORY_KINDS).optional(),
  attributes: memoryAttributesSchema.optional(),
  risk: z.enum(["low", "sensitive", "ambiguous"]),
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(50000),
  source_refs: z.array(sourceSchema).min(1).max(20),
  change_explanation: changeExplanationSchema.optional().describe("Host-authored semantic difference and qualified cause. Never invent user-stated reasons; use unknown/null when absent. Stored in durable Lineage history, not ordinary recall."),
}).strict().superRefine((intent, context) => {
  if (intent.lifecycle_class === "episode" && intent.operation === "create") {
    context.addIssue({
      code: "custom",
      path: ["operation"],
      message: "episode memories must use append_episode",
    });
  }
});

export const deletionSchema = z.object({
  memory_id: z.string().min(1).max(240),
  confirmation: z.literal(true),
  user_instruction: z.string().min(1).max(2000),
  expected_content_hash: z.string().min(1),
  expected_updated_at: z.string().min(1),
}).strict();

export const restoreSchema = z.object({
  memory_id: z.string().min(1).max(240),
  strategy: z.enum(["activate", "coexist", "replace_current"]),
  confirmation: z.literal(true),
  expected_content_hash: z.string().min(1),
  expected_updated_at: z.string().min(1),
}).strict();

export const deferReviewSchema = z.object({
  review_id: z.string().min(1).max(240),
  confirmation: z.literal(true),
  name: z.string().min(1).max(200),
  category: z.enum(["memory", "retrieval", "sync", "architecture", "admin", "frontend", "other"]),
  priority: z.enum(["High", "Medium", "Low"]),
  summary: z.string().min(1).max(5000),
  why_deferred: z.string().min(1).max(5000),
  reconsider_when: z.string().min(1).max(5000),
  next_review: z.string().date().optional(),
  related_version: z.string().max(160).optional(),
  source_component: z.string().max(160).optional(),
}).strict();
