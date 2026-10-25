import { createHash } from "node:crypto";
import { isBackgroundEntry } from "./background.js";
import { assignRecallSemantics } from "./tiering.js";
import { relevantChunk } from "./chunks.js";

const SOURCES = ["soft-rejected", "raw", "fts", "situation", "vector", "entity", "association"];

export function buildJevSnapshot({ runtime, entries }, baseline, input) {
  const trace = new Map(baseline.trace.candidates.map((item) => [item.id, item]));
  const rows = entries.map((row) => snapshotRow(row, runtime, trace)).filter(Boolean);
  const queues = SOURCES.map((source) => rows.filter((row) => row.sources.includes(source)));
  const selected = new Map();
  let chars = 2;
  for (let position = 0; position < rows.length && selected.size < 24; position += 1) {
    for (const queue of queues) {
      const row = queue[position];
      if (!row || selected.has(row.candidate.candidate_id)) continue;
      const size = JSON.stringify(row.candidate).length + (selected.size ? 1 : 0);
      if (chars + size > 12000 || selected.size >= 24) continue;
      selected.set(row.candidate.candidate_id, row);
      chars += size;
    }
  }
  const candidates = [...selected.values()].map((row) => row.candidate);
  const payload = { schema_version: "jev-candidates-v1", query: input.query,
    query_representation: runtime.queryContext.facets || runtime.queryContext.contextEnvelope || null,
    context: input.context || "general", intimacy_mode: input.intimacyMode || "off", candidates };
  const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return { payload, fingerprint, rows: [...selected.values()],
    coverage: { eligible_count: rows.length, selected_count: candidates.length,
      truncated_count: rows.length - candidates.length, selected_chars: chars,
      max_items: 24, char_budget: 12000,
      source_counts: Object.fromEntries(SOURCES.map((source) => [source,
        [...selected.values()].filter((row) => row.sources.includes(source)).length])),
      semantic_guard_observed: Boolean(runtime.observationGuardReason) } };
}

function snapshotRow(row, runtime, trace) {
  const { entry } = row;
  const memory = entry.memory;
  const sources = [];
  if (entry.rawEvidenceScore > 0 || entry.contextualEvidenceScore > 0) sources.push("raw");
  if (runtime.ftsShadowRanks.has(memory.id)) sources.push("fts");
  if (runtime.observationSituationIds.has(memory.id)) sources.push("situation");
  if (runtime.vectorById.has(memory.id)) sources.push("vector");
  if (entry.entityEvidence) sources.push("entity");
  if (runtime.associationById.has(memory.id)) sources.push("association");
  if (!sources.length) return null;
  const old = trace.get(memory.id);
  if (!old?.final) sources.unshift("soft-rejected");
  const background = isBackgroundEntry(assignRecallSemantics([entry])[0]);
  const summary = String(memory.recall_summary || "").trim();
  const text = summary || memory.content;
  const window = relevantChunk(text, runtime.queryContext.rawQuery, runtime.envelope, 800);
  const view = summary ? "summary" : memory.public_projection_only ? "public_projection" : "canonical";
  const snippetId = createHash("sha256").update(`${memory.id}:${memory.content_hash}:${view}:${window.chunk?.start || 0}`).digest("hex").slice(0, 24);
  const candidate = { candidate_id: memory.id, content_hash: memory.content_hash, version: memory.version,
    title: memory.title.slice(0, 160), kind: memory.kind, status: memory.status,
    family_key: memory.family_key, event_date: memory.event_date,
    protected_direct: entry.rawDirectEvidence,
    context_check: memory.sensitivity === "intimate" && runtime.context === "private" && ["model", "proactive"].includes(runtime.intimacyMode),
    allowed_uses: [background ? "background" : "supporting", "omit"],
    snippet: { id: snippetId, representation: view, start: window.chunk?.start || 0,
      end: window.chunk?.end || 0, truncated: window.truncated, text: window.content } };
  return { candidate, entry, sources, baselineSelected: Boolean(old?.final), baselineReason: old?.reason || null };
}
