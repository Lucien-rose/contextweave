import { projectMemoryCard } from "../memory-card.js";
import { getMemory } from "../database.js";
import { admissionDecision } from "./admission.js";
import { normalizeContextEnvelope } from "./context.js";
import { excerpt } from "./presentation.js";
import { boundedText } from "../lib/text.js";
import { memorySummary, publicRecallProjection } from "../memory-summary.js";
import { relevantChunk } from "./chunks.js";

export function expandRecallMemory(db, {
  memoryId,
  query = "",
  context = "general",
  intimacyMode = "off",
  contextEnvelope = null,
  detail = "relevant_chunk",
  maxChars = 1800,
} = {}) {
  const original = getMemory(db, memoryId);
  if (!original) return null;
  const memory = publicRecallProjection(original, context);
  const admission = admissionDecision(memory, { query, context, intimacyMode });
  if (!admission.allowed) {
    return {
      memory_id: memory.id,
      available: false,
      reason: admission.reason,
    };
  }

  const budget = Math.max(240, Math.min(20000, Number(maxChars) || 1800));
  const envelope = normalizeContextEnvelope(contextEnvelope);
  const summary = memorySummary(memory);
  const selected = detail === "full"
    ? boundedText(memory.content, budget)
    : detail === "summary"
    ? { ...boundedText(summary || excerpt(memory.content, 720), budget),
        truncated: (summary || memory.content).length > Math.min(budget, summary ? budget : 720) }
    : relevantChunk(memory.content, query, envelope, budget);

  return {
    ...projectMemoryCard(memory, { content: selected.content, detailLevel: detail, navigation: { query, context, intimacyMode } }),
    memory_id: memory.id,
    title: memory.title,
    available: true,
    detail_level: memory.public_projection_only ? "public_projection"
      : detail === "summary" && !summary ? "excerpt" : detail,
    canonical_content_available: !memory.public_projection_only,
    content: selected.content,
    truncated: selected.truncated,
    ...(selected.chunk ? { chunk: selected.chunk } : {}),
    summary_available: Boolean(memorySummary(memory)),
    event_date: memory.event_date,
    sensitivity: memory.sensitivity,
    family_key: memory.family_key,
    content_hash: memory.content_hash,
    updated_at: memory.updated_at,
    version: memory.version,
  };
}


