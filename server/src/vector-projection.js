import { clampInteger } from "./lib/number.js";
import { safeDiscoveryText, safeDiscoveryTitle } from "./recall/disclosure.js";
import { vectorEnvValue, normalizeVectorBodyPolicy, VECTOR_BODY_POLICIES } from "./vector-settings.js";

const DEFAULT_BODY_POLICY = "private";
const DEFAULT_CHUNK_CHARS = 4000;
const DEFAULT_CHUNK_OVERLAP = 320;
const DEFAULT_MAX_CHUNKS = 16;

export function memoryVectorDocuments(memory) {
  const prefix = memoryMetadataProjection(memory);
  const canonicalBody = bodyAllowed(memory) ? String(memory.content || "").trim() : "";
  const body = canonicalBody;
  const chunkKind = "body";
  const docs = [];
  if (prefix) docs.push({ chunk_index: 0, chunk_kind: "metadata", text: prefix });
  if (!body) return docs;
  const chunks = chunkText(body);
  const bodyPrefix = prefix ? `${prefix}\n` : "";
  for (let index = 0; index < chunks.length; index += 1) {
    docs.push({
      chunk_index: index + 1,
      chunk_kind: chunkKind,
      text: `${bodyPrefix}content: ${chunks[index]}`.slice(0, 7000),
    });
  }
  return docs;
}

export function memoryVectorProjection(memory) {
  return memoryVectorDocuments(memory).map((item) => item.text).join("\n---\n");
}

function memoryMetadataProjection(memory) {
  const restricted = ["sensitive", "intimate"].includes(memory.sensitivity);
  const safe = (value) => !restricted || safeDiscoveryText(value);
  const lines = [];
  if (memory.title && (!restricted || safeDiscoveryTitle(memory.title))) lines.push(`title: ${memory.title}`);
  if (memory.event_date) lines.push(`date: ${memory.event_date}`);
  const addList = (label, values) => {
    const selected = (values || []).filter((value) => safe(value)).slice(0, 20);
    if (selected.length) lines.push(`${label}: ${selected.join(" | ")}`);
  };
  addList("tags", memory.tags);
  addList("triggers", memory.triggers);
  addList("ambient", memory.ambient_triggers);
  if (memory.kind) lines.push(`kind: ${memory.kind}`);
  return lines.join("\n").slice(0, 2200);
}

function chunkText(text) {
  const chunkChars = clampInteger(vectorEnvValue("MOSS_VECTOR_CHUNK_CHARS", DEFAULT_CHUNK_CHARS), 1000, 6000, DEFAULT_CHUNK_CHARS);
  const overlap = clampInteger(vectorEnvValue("MOSS_VECTOR_CHUNK_OVERLAP", DEFAULT_CHUNK_OVERLAP), 0, Math.floor(chunkChars / 3), DEFAULT_CHUNK_OVERLAP);
  const maxChunks = clampInteger(vectorEnvValue("MOSS_VECTOR_MAX_CHUNKS", DEFAULT_MAX_CHUNKS), 1, 32, DEFAULT_MAX_CHUNKS);
  if (text.length <= chunkChars) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length && chunks.length < maxChunks) {
    const hardEnd = Math.min(text.length, start + chunkChars);
    const end = findNaturalBoundary(text, start, hardEnd);
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks.filter(Boolean);
}

function findNaturalBoundary(text, start, hardEnd) {
  if (hardEnd >= text.length) return text.length;
  const floor = Math.max(start + Math.floor((hardEnd - start) * 0.72), start + 1);
  for (let index = hardEnd; index >= floor; index -= 1) {
    if (/[。！？!?；;\n]/.test(text[index - 1] || "")) return index;
  }
  return hardEnd;
}

function bodyAllowed(memory) {
  const policy = bodyPolicy();
  if (policy === "all") return true;
  if (policy === "metadata") return false;
  if (policy === "non-intimate") return memory.sensitivity !== "intimate";
  return ["personal", "private"].includes(memory.sensitivity);
}

export function bodyPolicy() {
  const configured = normalizeVectorBodyPolicy(String(vectorEnvValue("MOSS_VECTOR_BODY_POLICY", DEFAULT_BODY_POLICY)).toLowerCase());
  return VECTOR_BODY_POLICIES.includes(configured) ? configured : DEFAULT_BODY_POLICY;
}

