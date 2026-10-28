import { z } from "zod/v4";
import { intentSchema } from "../../evolution/contract.js";
import { bootstrapRequestSchema, recallRequestSchema } from "../../recall/request.js";
import { contextSchema, intimacyModeSchema, contextEnvelopeSchema } from "../../recall/context-contract.js";

const id = z.string().min(1).max(240);
export const ingestSchema = intentSchema.safeExtend({
  operation: z.enum(["create", "append_episode"]).default("create"),
  authority: intentSchema.shape.authority.default("delegated"),
  lifecycle_class: intentSchema.shape.lifecycle_class.default("belief"),
  risk: intentSchema.shape.risk.default("low"),
});
export const evolveSchema = intentSchema.safeExtend({
  operation: z.enum(["reinforce", "supersede", "coexist", "correct"]),
  target_memory_id: id,
  expected_content_hash: z.string().min(1),
  expected_updated_at: z.string().min(1),
});
export const readSchema = z.object({
  memory_id: id,
  query: z.string().min(1).max(4000),
  context: contextSchema.default("general"),
  intimacy_mode: intimacyModeSchema.default("off"),
  context_envelope: contextEnvelopeSchema.optional(),
  detail: z.enum(["relevant_chunk", "summary", "full"]).default("relevant_chunk"),
  max_chars: z.number().int().min(240).max(20000).default(1800),
}).strict();
export const deliverySchema = z.object({
  receipt_id: id.startsWith("delivery:"),
  memory_ids: z.array(id).min(1).max(64),
}).strict();

export const operations = Object.freeze([
  { name: "ingest", method: "POST", path: "/ingest", role: "runtime", schema: ingestSchema },
  { name: "recall", method: "POST", path: "/recall", role: "runtime", schema: recallRequestSchema },
  { name: "evolve", method: "POST", path: "/evolve", role: "runtime", schema: evolveSchema },
  { name: "read", method: "POST", path: "/read", role: "runtime", schema: readSchema },
  { name: "bootstrap", method: "POST", path: "/bootstrap", role: "runtime", schema: bootstrapRequestSchema },
  { name: "delivered", method: "POST", path: "/recall/delivered", role: "runtime", schema: deliverySchema },
  { name: "change", method: "POST", path: "/changes/read", role: "runtime", schema: z.object({ change_id: id }).strict() },
  { name: "reviews", method: "GET", path: "/admin/reviews", role: "admin" },
]);

export function describeApi() {
  return {
    api_version: "1",
    operations: operations.map(({ schema, ...operation }) => ({
      ...operation, path: `/api/v1${operation.path}`,
      ...(schema ? { input: z.toJSONSchema(schema, { io: "input" }) } : {}),
    })),
  };
}
