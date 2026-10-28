import { createHash } from "node:crypto";
import { isBackgroundEntry } from "./background.js";
import { assignRecallSemantics } from "./tiering.js";
import { relevantChunk } from "./chunks.js";
import { associationContext } from "./association-context.js";
import { buildJevRequest } from "./jev-provider.js";

const SOURCES = ["soft-rejected", "raw", "fts", "situation", "vector", "entity", "association"];

export function buildJevSnapshot({ runtime, entries }, baseline, input) {
  const trace = new Map(baseline.trace.candidates.map(item => [item.id, item]));
  const inspected = new Map(entries.filter(row => row.formalAllowed)
    .map(({ entry }) => [entry.memory.id, entry.memory]));
  const rows = entries.map(row => snapshotRow(row, runtime, trace, inspected)).filter(Boolean);
  const payloadFor = batchRows => ({ schema_version: "jev-candidates-v3", query: input.query,
    query_representation: runtime.queryContext.facets || runtime.queryContext.contextEnvelope || null,
    context: input.context || "general", intimacy_mode: input.intimacyMode || "off",
    candidates: batchRows.map(row => row.candidate) });
  const sizeOf = batchRows => JSON.stringify(buildJevRequest(payloadFor(batchRows))).length;
  const required = rows.filter(row => row.baselineSelected || row.localEligible || row.entry.associationEvidence)
    .sort((a, b) => Number(b.baselineSelected) - Number(a.baselineSelected)
      || (a.entry.associationRank || Infinity) - (b.entry.associationRank || Infinity));
  const buckets = [[]], selected = new Map();
  const add = (row, mayOpenBatch) => {
    if (!row || selected.has(row.candidate.candidate_id)) return;
    let bucket = buckets.find(items => items.length < 24 && sizeOf([...items, row]) <= 12000);
    if (!bucket && mayOpenBatch && buckets.length < 3 && sizeOf([row]) <= 12000) {
      bucket = [];
      buckets.push(bucket);
    }
    if (!bucket) return;
    bucket.push(row);
    selected.set(row.candidate.candidate_id, row);
  };
  for (const row of required) add(row, true);
  const queues = SOURCES.map(source => rows.filter(row => row.sources.includes(source)));
  for (let position = 0; position < rows.length; position += 1) {
    for (const queue of queues) add(queue[position], false);
  }
  const selectedRows = [...selected.values()];
  const batches = buckets.filter(items => items.length).map(items => ({ payload: payloadFor(items) }));
  const payload = payloadFor(selectedRows);
  const baselineRows = rows.filter(row => row.baselineSelected);
  const missing = required.filter(row => !selected.has(row.candidate.candidate_id));
  const pathRows = rows.filter(row => row.entry.associationEvidence);
  const seeds = [...new Set(payload.candidates.map(candidate => candidate.association_context?.seed.id).filter(Boolean))]
    .map(id => inspected.get(id));
  return { payload, batches, rows: selectedRows, seeds,
    fingerprint: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    coverage: { eligible_count: rows.length, selected_count: selectedRows.length,
      truncated_count: rows.length - selectedRows.length,
      selected_chars: Math.max(0, ...batches.map(batch => JSON.stringify(buildJevRequest(batch.payload)).length)),
      total_request_chars: batches.reduce((sum, batch) => sum + JSON.stringify(buildJevRequest(batch.payload)).length, 0),
      batch_count: batches.length, max_batches: 3, max_items: 24, char_budget: 12000,
      baseline_selected_count: baselineRows.length,
      baseline_covered_count: baselineRows.filter(row => selected.has(row.candidate.candidate_id)).length,
      baseline_truncated_count: baselineRows.filter(row => !selected.has(row.candidate.candidate_id)).length,
      required_count: required.length, required_truncated_count: missing.length,
      deferred_ids: missing.map(row => row.candidate.candidate_id),
      association_required_count: pathRows.length,
      association_covered_count: pathRows.filter(row => selected.has(row.candidate.candidate_id)).length,
      source_counts: Object.fromEntries(SOURCES.map(source => [source,
        selectedRows.filter(row => row.sources.includes(source)).length])),
      semantic_guard_observed: Boolean(runtime.observationGuardReason) } };
}

function snapshotRow(row, runtime, trace, inspected) {
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
    ...(entry.associationEvidence ? { association_context: associationContext(entry, runtime, inspected),
      requires_path_judgment: true } : {}),
    context_check: memory.sensitivity === "intimate" && runtime.context === "private" && ["model", "proactive"].includes(runtime.intimacyMode),
    allowed_uses: background ? ["background", "omit"] : ["supporting", "background", "omit"],
    snippet: { id: snippetId, representation: view, start: window.chunk?.start || 0,
      end: window.chunk?.end || 0, truncated: window.truncated, text: window.content } };
  return { candidate, entry, formalAllowed: row.formalAllowed, sources, localEligible: old?.admission === "admit",
    baselineSelected: Boolean(old?.final), baselineReason: old?.reason || null };
}
