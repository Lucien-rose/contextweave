import { z } from "zod/v4";
import { observationSchema, sensitivityRank } from "../portrait/runtime-contract.js";
import { recordSourceMaterial } from "../source-materials.js";
import { publicError } from "../lib/error.js";

export const batchInputFields = {
  subject_id: z.string().min(1).max(160).default("user"),
  source_surface: z.string().min(1).max(100),
  session_id: z.string().min(1).max(240),
  source_revision: z.number().int().min(1),
  events: z.array(observationSchema).min(1).max(64),
};

export function validateBatch(value, ctx) {
  if (value.events.reduce((sum, event) => sum + event.text.length, 0) > 64000) {
    ctx.addIssue({ code: "custom", message: "Split batches larger than 64000 text characters" });
  }
  const ids = new Set();
  for (const event of value.events) {
    if (ids.has(event.event_id) || event.subject_id !== value.subject_id || event.session_id !== value.session_id
      || event.scope !== "real") ctx.addIssue({ code: "custom", message: "Batch requires unique real events from its subject/session" });
    ids.add(event.event_id);
  }
}

export const batchInputSchema = z.object(batchInputFields).strict().superRefine(validateBatch);

export function batchSensitivity(events) {
  return events.reduce((max, event) => sensitivityRank[event.sensitivity] > sensitivityRank[max] ? event.sensitivity : max, "personal");
}

export function preserveBatchEvidence(db, input) {
  return input.events.map((event) => ({ ...event, source_refs: event.source_refs.map((ref) => {
    if (ref.source_type === "memory") throw publicError("Submit conversation evidence, not derived memory, as batch events");
    const context = ref.source_context;
    if (context && (!context.content.includes(event.text)
      || sensitivityRank[context.sensitivity] > sensitivityRank[event.sensitivity])) {
      throw publicError("Batch evidence must contain its event and preserve sensitivity");
    }
    const source = { ...ref, source_context: { ...context, content: context?.content || event.text,
      speaker: event.role, conversation_id: input.session_id, message_id: event.event_id,
      sensitivity: event.sensitivity, occurred_at: event.occurred_at } };
    const material = recordSourceMaterial(db, source);
    if (sensitivityRank[material.sensitivity] > sensitivityRank[event.sensitivity]) {
      throw publicError("Batch must preserve existing evidence sensitivity", 403);
    }
    const { source_context, ...metadata } = source;
    return { ...metadata, material_id: material.id };
  }) }));
}
