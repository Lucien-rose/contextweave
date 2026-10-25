import { evaluateSituationGuard } from "./situation-guard.js";
import { analyzeRecallQuery } from "./recall/query-focus.js";

import { SITUATION_PROJECTION_GENERATION as PROJECTION_GENERATION } from "./recall/constants.js";

const MEMORY_FIELDS = Object.freeze(["title", "body", "metadata", "ambient"]);
const STRUCTURED_MEMORY_FIELDS = Object.freeze(["title", "metadata", "ambient"]);
const QUERY_ANCHOR_MAX_DOCUMENT_RATIO = 0.2;
const FIELD_WEIGHTS = Object.freeze({ title: 3, body: 1.5, metadata: 2.25, ambient: 2 });
const SOURCE_WEIGHTS = Object.freeze({ query: 1, context: 3 });
const RRF_K = 60;
const RRF_WEIGHTS = Object.freeze({ lexical: 1.25, situation: 1 });
const WORD_SEGMENTER = new Intl.Segmenter("zh-CN", { granularity: "word" });
const TOKEN_LIMIT = 192;
const MIN_TOKEN_LENGTH = 2;
const MAX_TOKEN_LENGTH = 36;

export function situationProjectionGeneration() {
  return PROJECTION_GENERATION;
}

export function buildMemorySituationProjection(memory) {
  const fields = {
    title: projectText(memory?.title),
    body: projectText(memory?.content),
    metadata: projectText([
      memory?.tags,
      memory?.triggers,
      memory?.tags_json,
      memory?.triggers_json,
    ]),
    ambient: projectText([
      memory?.ambient_triggers,
      memory?.ambient_triggers_json,
    ]),
  };
  return {
    generation: PROJECTION_GENERATION,
    fields,
    tokens: unique(MEMORY_FIELDS.flatMap((field) => fields[field])),
  };
}

export function buildSituationQuery(value) {
  const input = normalizeQueryInput(value);
  const guard = evaluateSituationGuard({ query: input.query, entities: input.entities });
  const reason = guard.reason;
  const queryFocus = analyzeRecallQuery(input.query);
  const tokenWeights = new Map();
  addWeightedTokens(tokenWeights, projectText(queryFocus.searchText), SOURCE_WEIGHTS.query);
  addWeightedTokens(tokenWeights, projectText(input.context), SOURCE_WEIGHTS.context);
  const tokens = [...tokenWeights.keys()].slice(0, TOKEN_LIMIT);
  return {
    generation: PROJECTION_GENERATION,
    tokens,
    tokenWeights,
    queryTokens: new Set(projectText(queryFocus.searchText)),
    contextTokens: new Set(projectText(input.context)),
    queryFocus,
    blocked: Boolean(reason),
    reason: reason || (tokens.length ? null : "no-situation-signal"),
  };
}

export function buildSituationMatch(value, { ignoreSemanticGuard = false } = {}) {
  const query = buildSituationQuery(value);
  return {
    ...query,
    expression: query.blocked && !ignoreSemanticGuard
      ? ""
      : query.tokens.map((token) => `"${escapeFtsToken(token)}"`).join(" OR "),
  };
}

export function scoreSituationCandidates(query, rows) {
  const documents = rows.map((row, index) => ({
    row,
    lexicalPosition: index + 1,
    fields: projectionTokenSetsFromRow(row),
  }));
  const documentFrequency = new Map();
  const structuredDocumentFrequency = new Map();
  for (const token of query.tokens) {
    documentFrequency.set(token, documents.filter(({ fields }) =>
      MEMORY_FIELDS.some((field) => fields[field].has(token))).length);
    if (query.queryTokens.has(token)) {
      structuredDocumentFrequency.set(token, documents.filter(({ fields }) =>
        STRUCTURED_MEMORY_FIELDS.some((field) => fields[field].has(token))).length);
    }
  }
  const corpusSize = Math.max(1, documents.length);
  const maxSelectiveAnchorDocumentFrequency = Math.max(
    1,
    Math.ceil(corpusSize * QUERY_ANCHOR_MAX_DOCUMENT_RATIO),
  );
  const scored = documents.map(({ row, fields, lexicalPosition }) => {
    const matched = [];
    let overlapScore = 0;
    let matchedWeight = 0;
    let totalWeight = 0;
    let queryMatches = 0;
    let contextMatches = 0;
    let structuredQueryMatches = 0;
    let selectiveQueryAnchorMatches = 0;
    let bestQueryAnchorSelectivity = 0;
    for (const token of query.tokens) {
      const sourceWeight = query.tokenWeights.get(token) || SOURCE_WEIGHTS.query;
      const idf = Math.log((corpusSize + 1) / ((documentFrequency.get(token) || 0) + 1)) + 1;
      const evidenceWeight = sourceWeight * idf;
      totalWeight += evidenceWeight;
      const field = bestMatchingField(fields, token);
      if (!field) continue;
      matched.push(token);
      matchedWeight += evidenceWeight;
      overlapScore += evidenceWeight * FIELD_WEIGHTS[field];
      if (query.queryTokens.has(token)) {
        queryMatches += 1;
        const structuredMatch = STRUCTURED_MEMORY_FIELDS.some((fieldName) => fields[fieldName].has(token));
        if (structuredMatch) {
          structuredQueryMatches += 1;
          const structuredFrequency = structuredDocumentFrequency.get(token) || 0;
          const selectivity = 1 - Math.min(1, structuredFrequency / corpusSize);
          bestQueryAnchorSelectivity = Math.max(bestQueryAnchorSelectivity, selectivity);
          if (structuredFrequency > 0 && structuredFrequency <= maxSelectiveAnchorDocumentFrequency) {
            selectiveQueryAnchorMatches += 1;
          }
        }
      }
      if (query.contextTokens.has(token)) contextMatches += 1;
    }
    const coverage = totalWeight ? matchedWeight / totalWeight : 0;
    const contextual = query.contextTokens.size > 0;
    const overlapQualified = contextual
      ? contextMatches >= 2 && coverage >= 0.16 && overlapScore >= 8
      : matched.length >= 2 && coverage >= 0.24 && overlapScore >= 5;
    // FTS5 supplies field-aware BM25 length normalization. Preserve a strong
    // lexical result when a short, specific memory covers fewer concepts from
    // a long context envelope than a broad document does.
    const lexicalQualified = lexicalPosition <= 3
      && (queryMatches >= 2 || contextMatches >= 2)
      && overlapScore >= 5;
    return {
      id: row.memory_id,
      lexical_rank: Number(row.lexical_rank),
      lexical_position: lexicalPosition,
      matched,
      overlap_count: matched.length,
      overlap_score: round(overlapScore),
      coverage: round(coverage),
      query_match_count: queryMatches,
      context_match_count: contextMatches,
      structured_query_match_count: structuredQueryMatches,
      selective_query_anchor_count: selectiveQueryAnchorMatches,
      query_anchor_selectivity: round(bestQueryAnchorSelectivity),
      query_anchor_qualified: selectiveQueryAnchorMatches > 0,
      overlap_qualified: overlapQualified,
      lexical_qualified: lexicalQualified,
      qualified: overlapQualified || lexicalQualified,
    };
  });

  const overlapPosition = new Map([...scored]
    .sort(compareSituationOverlap)
    .map((item, index) => [item.id, index + 1]));

  return scored.map((item) => {
    const situationPosition = overlapPosition.get(item.id) || scored.length;
    const hybridScore = (
      RRF_WEIGHTS.lexical / (RRF_K + item.lexical_position)
      + RRF_WEIGHTS.situation / (RRF_K + situationPosition)
    );
    return {
      ...item,
      overlap_position: situationPosition,
      hybrid_score: round(hybridScore * 100000),
    };
  });
}

export function compareSituationCandidates(a, b) {
  return b.hybrid_score - a.hybrid_score
    || b.overlap_score - a.overlap_score
    || b.coverage - a.coverage
    || a.lexical_position - b.lexical_position
    || String(a.id).localeCompare(String(b.id));
}

export function projectionColumns(projection) {
  return MEMORY_FIELDS.map((field) => projection.fields[field].join(" "));
}

function projectionTokenSetsFromRow(row) {
  return Object.fromEntries(MEMORY_FIELDS.map((field) => [
    field,
    new Set(String(row?.[field] || "").split(/\s+/).filter(Boolean)),
  ]));
}

function bestMatchingField(fields, token) {
  return MEMORY_FIELDS
    .filter((field) => fields[field].has(token))
    .sort((a, b) => FIELD_WEIGHTS[b] - FIELD_WEIGHTS[a])[0] || null;
}

function compareSituationOverlap(a, b) {
  return b.overlap_score - a.overlap_score
    || b.coverage - a.coverage
    || b.context_match_count - a.context_match_count
    || b.overlap_count - a.overlap_count
    || a.lexical_position - b.lexical_position
    || String(a.id).localeCompare(String(b.id));
}

function addWeightedTokens(target, tokens, weight) {
  for (const token of tokens) target.set(token, Math.max(target.get(token) || 0, weight));
}

function projectText(value) {
  const normalized = normalize(flattenText(value));
  if (!normalized) return [];
  const output = [];
  for (const item of WORD_SEGMENTER.segment(normalized)) {
    if (!item.isWordLike) continue;
    const token = canonicalToken(item.segment);
    if (!token) continue;
    output.push(token);
    if (/^[\p{Script=Han}]+$/u.test(token) && token.length >= 4) {
      for (let index = 0; index <= token.length - 2; index += 1) {
        output.push(token.slice(index, index + 2));
      }
    }
  }
  return unique(output).slice(0, TOKEN_LIMIT);
}

function canonicalToken(value) {
  const token = normalize(value).replace(/[^a-z0-9_\-\p{Script=Han}]+/giu, "");
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) return "";
  if (/^\d+$/.test(token)) return "";
  return token;
}

function normalizeQueryInput(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      query: String(value.query || ""),
      context: flattenText(value.context || value.evidence || []),
      entities: cleanArray(value.envelope?.entities),
    };
  }
  const values = Array.isArray(value) ? value : [value];
  return { query: String(values[0] || ""), context: flattenText(values.slice(1)), entities: [] };
}

function cleanArray(value) {
  return Array.isArray(value)
    ? unique(value.map((item) => normalize(item)).filter(Boolean)).slice(0, 12)
    : [];
}

function escapeFtsToken(value) {
  return String(value).replace(/"/g, '""');
}

function flattenText(values) {
  const output = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    if (Array.isArray(value)) output.push(flattenText(value));
    else if (value !== null && value !== undefined) output.push(String(value));
  }
  return output.join(" ");
}

function unique(values) {
  return [...new Set(values)];
}

function normalize(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}
