import { namespaceSchema } from "../entity/contract.js";
import { parseContract } from "../lib/contract.js";
import { ownerMemoryCard } from "../memory-card.js";
import { publicError as badRequest } from "../lib/error.js";
import { cleanOptional } from "../lib/text.js";
export { cleanOptional } from "../lib/text.js";
export { publicError as badRequest } from "../lib/error.js";
const MAX_BODY_BYTES = 256 * 1024;

export async function readJson(req, limit = MAX_BODY_BYTES) {
  if (req.body !== undefined) return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = badRequest("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw badRequest("Invalid JSON body");
  }
}

export function publicMemory(memory) {
  const { source_hash, ...safe } = ownerMemoryCard(memory);
  return safe;
}

export function publicCandidate(candidate) {
  const { tags_json, triggers_json, policy_reasons_json, ...safe } = candidate;
  return {
    ...safe,
    source_refs: (safe.source_refs || []).map(({ source_context, ...source }) => ({
      ...source,
      context_available: Boolean(source.material_id || source_context),
    })),
  };
}

export function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export function cleanRequired(value, label, max) {
  const result = String(value || "").trim();
  if (!result) throw badRequest(`${label} is required`);
  if (result.length > max) throw badRequest(`${label} is too long`);
  return result;
}

export function cleanStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) throw badRequest("Tags and triggers must be arrays");
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLength));
}

export function optionalStringArray(value, maxItems, maxLength) {
  return value == null ? [] : cleanStringArray(value, maxItems, maxLength);
}

export function optionalContextEnvelope(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("context_envelope must be an object");
  }
  return {
    entity_namespace: value.entity_namespace == null ? undefined : parseContract(namespaceSchema, value.entity_namespace),
    speech_act: cleanOptional(value.speech_act, 80) || undefined,
    action_phase: cleanOptional(value.action_phase, 80) || undefined,
    entities: optionalStringArray(value.entities, 12, 120),
    topics: optionalStringArray(value.topics, 12, 120),
    state_cues: optionalStringArray(value.state_cues, 12, 120),
    recall_hypotheses: optionalStringArray(value.recall_hypotheses, 3, 500),
  };
}

export function emptyHomecomingBundle({ context, intimacyMode }) {
  return {
    schema_version: 2,
    purpose: "layered-homecoming",
    context,
    intimacy_mode: intimacyMode,
    deep_reads: { general: [], intimate: [] },
    working_summaries: [],
    anchors: { general: [], intimate: [] },
    agreement_manifest: [],
    observances: [],
    memories: [],
    budgets: { full_content_characters: 0, full_content_limit: 0 },
    guidance: "audience-gated",
  };
}

export function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw badRequest("Importance must be an integer");
  return Math.max(min, Math.min(max, number));
}

export function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

