import { containsText } from "../lib/text-match.js";
import { WORD_SEGMENTER, GENERIC_QUERY_TERMS } from "./constants.js";

// Derived reading windows only: offsets always address the untouched original.
export function readingChunks(content, { targetChars = 1400, overlap = 320 } = {}) {
  const text = String(content || "");
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(text.length, start + targetChars);
    const floor = start + Math.floor(targetChars * 0.55);
    let end = hardEnd;
    if (hardEnd < text.length) {
      const tail = text.slice(Math.min(floor, hardEnd), hardEnd);
      const boundaries = [...tail.matchAll(/\n(?=#{1,6}\s)|\n\s*\n|[。！？!?；;]\s*/g)];
      if (boundaries.length) {
        const last = boundaries.at(-1);
        end = floor + last.index + last[0].length;
      }
    }
    if (/[\uD800-\uDBFF]/.test(text[end - 1] || "")) end -= 1;
    if (end <= start) end = hardEnd;
    chunks.push({ start, end, content: text.slice(start, end) });
    if (end >= text.length) break;
    start = Math.max(start + 1, end - Math.min(overlap, Math.floor(targetChars / 3)));
    if (/[\uDC00-\uDFFF]/.test(text[start] || "")) start += 1;
  }
  return chunks;
}

export function relevantChunk(content, query, envelope, maxChars) {
  const chunks = readingChunks(content, { targetChars: Math.min(maxChars, 1400) });
  if (!chunks.length) return { content: "", truncated: false, chunk: null };
  const values = [query, ...envelope.topics, ...envelope.stateCues, ...envelope.hypotheses].join(" ");
  const terms = [...new Set([...WORD_SEGMENTER.segment(values.normalize("NFKC").toLowerCase())]
    .filter((part) => part.isWordLike && part.segment.length >= 2 && !GENERIC_QUERY_TERMS.has(part.segment))
    .map((part) => part.segment))];
  const ranked = chunks.map((chunk, index) => ({ ...chunk, index,
    score: terms.reduce((sum, term) => sum + (containsText(chunk.content, term) ? Math.min(6, term.length) : 0), 0),
  })).sort((a, b) => b.score - a.score || a.index - b.index);
  const best = ranked[0];
  return {
    content: best.content,
    truncated: best.start > 0 || best.end < content.length,
    chunk: { index: best.index, count: chunks.length, start: best.start, end: best.end },
  };
}
