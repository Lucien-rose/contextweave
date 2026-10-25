import { z } from "zod/v4";
import { listMemories } from "./database.js";
import { memorySummary, summaryRecommended } from "./memory-summary.js";
import { publicError } from "./lib/error.js";
import { admissionDecision } from "./recall/admission.js";
import { withRecallSettings } from "./recall/settings.js";
import { readDelegationPolicy } from "./evolution/policy.js";
import { parseContract } from "./lib/contract.js";
import { INTIMACY_MODES } from "./recall/modes.js";
import { applyMemorySummary } from "./memory-summary-store.js";

export const summarySetSchema = z.object({
  memory_id: z.string().min(1).max(240),
  recall_summary: z.string().trim().min(1).max(5000).nullable(),
  expected_content_hash: z.string().min(1), expected_updated_at: z.string().min(1),
}).strict();
const ownerSummarySetSchema = summarySetSchema.extend({
  public_projection: z.string().trim().min(1).max(5000).nullable().optional(),
});
export const summaryListSchema = z.object({
  context: z.enum(["general", "private", "intimate"]).default("general"),
  intimacy_mode: z.enum(INTIMACY_MODES).default("off"),
  limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).default(0),
}).strict();

export function listMissingSummaries(db, input = {}) {
  const request = parseContract(summaryListSchema, input);
  if (request.context === "general") return { memories: [], next_offset: null };
  const policy = withRecallSettings(db, { context: request.context, intimacyMode: request.intimacy_mode, query: "" });
  const rows = listMemories(db).filter((memory) => summaryRecommended(memory) && !memorySummary(memory)
    && admissionDecision(memory, policy).allowed);
  const end = request.offset + request.limit;
  return {
    memories: rows.slice(request.offset, end).map((memory) => ({
      id: memory.id, title: memory.title, characters: memory.content.length, kind: memory.kind,
      content_hash: memory.content_hash, updated_at: memory.updated_at,
      read_via: { tool: "moss_read", arguments: { memory_id: memory.id } },
    })),
    next_offset: end < rows.length ? end : null,
  };
}

export function setMemorySummary(db, input, { delegated = false } = {}) {
  const request = parseContract(delegated ? summarySetSchema : ownerSummarySetSchema, input);
  if (delegated && !readDelegationPolicy(db).enabled) throw publicError("Delegated memory maintenance is disabled", 403);
  return applyMemorySummary(db, request);
}
