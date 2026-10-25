import { summaryRecommended, memorySummary } from "../memory-summary.js";
import { parseContract } from "../lib/contract.js";
import { publicError } from "../lib/error.js";
import { backfillSchema, sensitivityRank } from "./runtime-contract.js";
import { runtimeSettings, enqueuePortraitJob } from "./queue.js";
import { portraitHash } from "./store.js";

export function enqueuePortraitBackfill(db, input) {
  const request = parseContract(backfillSchema, input);
  const settings = runtimeSettings(db);
  const memories = [...new Set(request.memory_ids)].map((id) => db.prepare("SELECT * FROM memories WHERE id=?").get(id));
  for (const memory of memories) {
    if (!memory || memory.status !== "active") throw publicError("Backfill requires active memories");
    if (sensitivityRank[memory.sensitivity] > sensitivityRank[settings.max_sensitivity]) throw publicError("Backfill exceeds configured sensitivity", 403);
    if (memory.content.length > 50000) throw publicError("Backfill source exceeds 50,000 characters; split source first");
  }
  return memories.filter((memory) => request.kind !== "summary" || (summaryRecommended(memory) && !memorySummary(memory)))
    .map((memory) => {
      const id = `backfill:${portraitHash([request.kind, request.subject_id, memory.id, memory.content_hash, memory.updated_at])}`;
      const events = [];
      for (let offset = 0; offset < memory.content.length; offset += 12000) {
        const text = memory.content.slice(offset, offset + 12000);
        events.push({ event_id: `${memory.id}:${offset}`, subject_id: request.subject_id, session_id: `memory:${memory.id}`,
          role: "user", scope: "real", text, sensitivity: memory.sensitivity,
          occurred_at: memory.event_date ? `${memory.event_date}T00:00:00Z` : memory.created_at,
          source_refs: [{ source_type: "memory", source_id: memory.id, source_hash: memory.content_hash,
            occurred_at: memory.event_date ? `${memory.event_date}T00:00:00Z` : memory.created_at }] });
      }
      enqueuePortraitJob(db, { id, kind: request.kind === "summary" ? "summary" : "backfill",
        subject_id: request.subject_id, session_id: `memory:${memory.id}`,
        input: { events, source: { id: memory.id, content_hash: memory.content_hash, updated_at: memory.updated_at } } });
      return { job_id: id, kind: request.kind, memory_id: memory.id };
    });
}

export function assertFreshJobSource(db, input) {
  for (const event of input.events) for (const ref of event.source_refs) {
    if (ref.source_type !== "memory") continue;
    const memory = db.prepare("SELECT content_hash FROM memories WHERE id=? AND status='active'").get(ref.source_id);
    if (!ref.source_hash || !memory || memory.content_hash !== ref.source_hash) throw publicError("Observation memory evidence changed or was removed", 409);
  }
  if (!input.source) return;
  const current = db.prepare("SELECT * FROM memories WHERE id=?").get(input.source.id);
  if (!current || current.status !== "active" || current.content_hash !== input.source.content_hash
    || current.updated_at !== input.source.updated_at) throw publicError("Backfill source changed or was removed", 409);
}
