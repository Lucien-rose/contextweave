import { ownerMemoryCard } from "../memory-card.js";
import { z } from "zod/v4";
export { z };
export { contextSchema, intimacyModeSchema, familyPolicySchema, recallControlSchema, contextEnvelopeSchema } from "../recall/context-contract.js";

export function result(structuredContent) {
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

export function compactDiagnosticTrace(trace) {
  const candidates = trace.candidates.filter((candidate) =>
    candidate.final
    || candidate.admission !== "reject"
    || candidate.candidate_sources.includes("fts-shadow")
    || candidate.candidate_sources.includes("situation-shadow")
    || candidate.candidate_sources.includes("vector")
    || candidate.candidate_sources.includes("association"));
  return {
    ...trace,
    diagnostic_candidate_count: candidates.length,
    candidates,
  };
}

export function errorResult(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function stripInternal(memory) {
  return ownerMemoryCard(memory);
}

export function gallerySummary(item) {
  const {
    tags_json, storage_name, original_file_name, mime_type,
    byte_length, content_hash, image_url, sort_order, ...safe
  } = item;
  return safe;
}
