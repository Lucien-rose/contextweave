import { getMemory } from "./database.js";
import { readSourceMaterial } from "./source-materials.js";
import { readSourceMaterialFocus, setSourceMaterialFocus } from "./source-material-focus.js";
import { admissionDecision } from "./recall/admission.js";
import { boundedText } from "./lib/text.js";

export function readSourceContext(db, {
  memoryId,
  sourceId = null,
  query = "",
  context = "general",
  intimacyMode = "off",
  maxChars = 4000,
  view = "focused",
} = {}) {
  const memory = getMemory(db, memoryId);
  if (!memory) return null;
  const admission = admissionDecision(memory, { query, context, intimacyMode });
  if (!admission.allowed) {
    return {
      memory_id: memory.id,
      available: false,
      reason: admission.reason,
      sources: [],
    };
  }

  return buildSourceContext(db, memory, { sourceId, maxChars, view });
}

export function readOwnerSourceContext(db, {
  memoryId,
  sourceId = null,
  maxChars = 50_000,
  view = "full",
  offset = null,
} = {}) {
  const memory = getMemory(db, memoryId);
  if (!memory) return null;
  return buildSourceContext(db, memory, { sourceId, maxChars, view, offset });
}

export function curateSourceContext(db, {
  memoryId,
  sourceId,
  expectedSourceHash,
  ranges = [],
  excerpts = [],
  updatedBy = "shared",
} = {}) {
  const memory = getMemory(db, memoryId);
  if (!memory) return null;
  const evidence = memory.evidence.find((item) => item.source_id === sourceId || item.material_id === sourceId);
  if (!evidence?.material_id) throw new TypeError("Stored source material not found for this memory");
  return setSourceMaterialFocus(db, {
    materialId: evidence.material_id,
    expectedSourceHash,
    ranges,
    excerpts,
    updatedBy,
  });
}

function buildSourceContext(db, memory, { sourceId, maxChars, view, offset = null }) {
  const contentView = view === "full" ? "full" : "focused";

  const budget = Math.max(400, Math.min(50_000, Number(maxChars) || 4000));
  const evidence = memory.evidence
    .filter((item) => !sourceId || item.source_id === sourceId || item.material_id === sourceId);
  let remaining = budget;
  const sources = evidence.map((item) => {
    const material = item.material_id ? readSourceMaterial(db, item.material_id) : null;
    const focus = material ? readSourceMaterialFocus(db, material.id, material) : null;
    const provider = material ? null : resolveProviderSource(db, item);
    const resolved = material || provider;
    const preferredContent = contentView === "focused" && focus?.content
      ? focus.content
      : resolved?.content;
    const content = preferredContent && remaining > 0
      ? offset === null ? boundedText(preferredContent, remaining)
        : { content: preferredContent.slice(offset, offset + remaining),
          truncated: offset + remaining < preferredContent.length }
      : null;
    if (content) remaining = Math.max(0, remaining - content.content.length);
    return {
      source_type: item.source_type,
      source_id: item.source_id,
      material_id: item.material_id,
      availability: material ? "stored" : provider ? "provider-resolved" : "provider-reference",
      integrity: item.source_integrity,
      authority: sourceAuthority(item),
      excerpt: item.excerpt,
      occurred_at: resolved?.occurred_at || item.occurred_at,
      written_at: resolved?.written_at || item.written_at,
      speaker: resolved?.speaker || item.metadata?.speaker || null,
      conversation_id: resolved?.conversation_id || item.metadata?.conversation_id || null,
      window_id: resolved?.window_id || item.metadata?.window_id || null,
      message_id: resolved?.message_id || item.metadata?.message_id || null,
      source_hash: item.source_hash || material?.content_hash || null,
      content_version: material?.content_version || null,
      content_view: focus?.content && contentView === "focused" ? "focus" : "full",
      full_content_available: Boolean(resolved?.content),
      focus_available: Boolean(focus?.content),
      focus_ranges: focus?.ranges || [],
      focus_updated_at: focus?.updated_at || null,
      focus_updated_by: focus?.updated_by || null,
      ...(content ? { content: content.content, truncated: content.truncated } : {}),
      ...(offset !== null ? { offset, content_length: preferredContent?.length || 0,
        next_offset: content?.truncated ? offset + content.content.length : null } : {}),
    };
  });
  return {
    memory_id: memory.id,
    family_key: memory.family_key,
    available: sources.length > 0,
    content_available: sources.some((source) => "content" in source),
    reason: sources.length ? null : "no-source-reference",
    source_integrity: aggregateIntegrity(sources),
    view: contentView,
    sources,
  };
}

function resolveProviderSource(db, evidence) {
  if (!["sentence-box", "sentence_box", "sentence"].includes(evidence.source_type)) return null;
  const row = db.prepare(`
    SELECT id, content, created_by, created_at, updated_at
    FROM sentence_box WHERE id = ?
  `).get(evidence.source_id);
  if (!row) return null;
  return {
    content: row.content,
    speaker: row.created_by,
    message_id: row.id,
    occurred_at: row.created_at,
    written_at: row.updated_at,
  };
}

function sourceAuthority(evidence) {
  const declared = String(evidence.metadata?.authority || "").trim();
  return declared || "unverified";
}

function aggregateIntegrity(sources) {
  if (!sources.length) return "incomplete";
  if (sources.every((source) => source.integrity === "complete")) return "complete";
  if (sources.some((source) => source.integrity === "complete")) return "mixed";
  if (sources.some((source) => source.integrity === "partial")) return "partial";
  if (sources.some((source) => source.integrity === "referenced")) return "referenced";
  return "incomplete";
}

