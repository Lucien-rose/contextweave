import { analyzeRecallQuery } from "./recall/query-focus.js";

const CJK_SEQUENCE = /[\u3400-\u9fff]+/g;
const LATIN_TERM = /[a-z0-9][a-z0-9_-]+/g;
const RETRIEVAL_ROLES = new Set(["direct_seed", "context_only", "source_only"]);
const CONTEXT_ONLY_KINDS = new Set([
  "affect", "dream", "portrait", "reflection", "relationship-weather", "summary",
]);
const SOURCE_ONLY_KINDS = new Set([
  "evidence", "raw-source", "source", "transcript",
]);

export function searchProjectionText(...values) {
  return searchProjectionTokens(values).join(" ");
}

export function buildFtsShadowMatch(values, { maxTerms = 64 } = {}) {
  const flattened = flatten(values);
  const focus = analyzeRecallQuery(flattened[0] || "");
  const terms = searchProjectionTokens([focus.searchText, ...flattened.slice(1)])
    .slice(0, Math.max(1, Number(maxTerms) || 64));
  return {
    expression: terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR "),
    termCount: terms.length,
    queryFocus: focus,
  };
}

export function retrievalRole(memory) {
  const declared = String(memory?.retrieval_role || "").trim().toLowerCase();
  if (RETRIEVAL_ROLES.has(declared)) return declared;
  const kind = String(memory?.kind || "memory").trim().toLowerCase();
  const layer = String(memory?.layer || "archive").trim().toLowerCase();
  if (SOURCE_ONLY_KINDS.has(kind) || layer === "source" || layer === "evidence") return "source_only";
  if (CONTEXT_ONLY_KINDS.has(kind) || layer === "derived") return "context_only";
  return "direct_seed";
}

function searchProjectionTokens(values) {
  const tokens = new Set();
  for (const value of flatten(values)) {
    const normalized = normalize(value);
    for (const term of normalized.match(LATIN_TERM) || []) tokens.add(term);
    for (const sequence of normalized.match(CJK_SEQUENCE) || []) {
      if (sequence.length >= 2 && sequence.length <= 16) tokens.add(sequence);
      for (let size = 2; size <= 3; size += 1) {
        for (let index = 0; index <= sequence.length - size; index += 1) {
          tokens.add(sequence.slice(index, index + size));
        }
      }
    }
  }
  return [...tokens];
}

function flatten(values) {
  const output = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    if (Array.isArray(value)) output.push(...flatten(value));
    else if (value !== null && value !== undefined) output.push(value);
  }
  return output;
}

function normalize(value) {
  return String(value || "").normalize("NFKC").toLowerCase();
}
