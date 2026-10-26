import { recallRepresentation } from "./presentation.js";
import { relevantChunk } from "./chunks.js";

export function directReading(entry) {
  const memory = entry.memory;
  if (memory.content.length <= 1400) {
    const representation = recallRepresentation(memory);
    return { content: representation.content, detail_level: representation.kind === "summary" ? "summary" : "full" };
  }
  const vector = entry.vectorChunk;
  const pinned = !entry.projectionOnly && vector?.chunk_kind === "body" && vector.content_hash === memory.content_hash
    && Number.isInteger(vector.chunk_start) && Number.isInteger(vector.chunk_end)
    && vector.chunk_start >= 0 && vector.chunk_end > vector.chunk_start && vector.chunk_end <= memory.content.length;
  const offset = pinned ? vector.chunk_start : 0;
  const text = pinned ? memory.content.slice(offset, vector.chunk_end) : memory.content;
  const chosen = relevantChunk(text, entry.readingQuery || "", entry.readingEnvelope || {
    topics: [], stateCues: [], hypotheses: [],
  }, 1400);
  return { content: chosen.content, excerpt: chosen.content.slice(0, 360), detail_level: entry.projectionOnly ? "public_projection" : "relevant_chunk", truncated: true,
    chunk: { ...chosen.chunk, start: offset + chosen.chunk.start, end: offset + chosen.chunk.end,
      content_hash: memory.content_hash, representation: entry.projectionOnly ? "public_projection" : "canonical", source: pinned ? "vector-hit" : "query",
      ...(pinned ? { vector_index: vector.chunk_index } : {}) },
    ...(!entry.projectionOnly ? { read_more: { memory_id: memory.id, detail: "full" } } : {}) };
}
