import { ANCHORS } from "../classify.js";
import {
  GENERIC_CONTEXT_EVIDENCE_PHRASES, GENERIC_IDENTITY_CUES, GENERIC_QUERY_PHRASES,
  GENERIC_QUERY_TERMS, INTIMATE_CATEGORY_QUERIES, MIN_RELEVANCE_SCORE, WORD_SEGMENTER,
} from "./constants.js";
import { contextualEvidenceHardeningEnabled, lexicalEvidenceV2Enabled, normalize, relativeTailFilterEnabled } from "./runtime.js";
import { deepCategory } from "./presentation.js";
import { dateCueMatches, fuzzyMetadataCue, scoreSemanticAliases } from "./lexical-signals.js";
import { containsText } from "../lib/text-match.js";

const QUERY_NOISE_PHRASES = normalizedPhrases(GENERIC_QUERY_PHRASES);
const CONTEXT_NOISE_PHRASES = normalizedPhrases(GENERIC_CONTEXT_EVIDENCE_PHRASES);

export function scoreMemory(memory, rawQuery, options = {}) {
  return scoreMemoryDetailed(memory, rawQuery, options).score;
}

export function scoreMemoryForContext(memory, rawQuery, envelope) {
  return resolveRecallEvidence(
    scoreMemoryDetailed(memory, rawQuery),
    scoreContextualEvidence(memory, envelope),
  ).discoveryScore;
}

export function scoreMemoryDetailed(memory, rawQuery, {
  allowFragmentOnly = false, allowFuzzy = true, features = null, queryFeatures = null,
} = {}) {
  const query = normalize(rawQuery);
  if (!query) return { score: 0, direct: false };
  const { ordinaryAmbientTriggers, title, content, canonicalHaystack, titleWords, metadataWords,
    haystackWords, haystackTerms } = features || memoryLexicalFeatures(memory);
  let score = 0;
  let matched = false;
  let direct = false;
  let explicit = false;
  let strongDirect = false;
  const matches = [];

  if (query && title === query) {
    score += 30; matched = true; direct = true; explicit = true; strongDirect = true;
    matches.push({ kind: "exact-title", term: query });
  } else if (containsText(title, query)) {
    score += 18; matched = true; direct = true; explicit = true; strongDirect = true;
    matches.push({ kind: "title-phrase", term: query });
  }
  if (containsText(content, query)) {
    score += 14; matched = true; direct = true; explicit = true; strongDirect = true;
    matches.push({ kind: "body-phrase", term: query });
  }
  if (memory.sensitivity === "intimate" && INTIMATE_CATEGORY_QUERIES.some((cue) => query.includes(cue))) {
    score += 8;
    matched = true;
    direct = true;
    explicit = true;
    strongDirect = true;
  }

  for (const trigger of [...memory.triggers, ...ordinaryAmbientTriggers]) {
    const normalized = normalize(trigger);
    if (!normalized) continue;
    const commonIdentity = GENERIC_IDENTITY_CUES.has(normalized);
    if (commonIdentity && !isIdentityLookupQuery(query, memory)) continue;
    if (query === normalized) { score += commonIdentity ? 8 : 24; matched = true; direct = true; explicit = true; strongDirect = true; }
    else if (containsText(query, normalized)) { score += commonIdentity ? 4 : 12; matched = true; direct = true; explicit = true; strongDirect = true; }
    else if (containsText(normalized, query) && query.length >= 2) { score += commonIdentity ? 3 : 7; matched = true; direct = true; explicit = true; strongDirect = true; }
  }

  for (const anchorTerm of ANCHORS) {
    const normalized = normalize(anchorTerm);
    if (GENERIC_IDENTITY_CUES.has(normalized) && !isIdentityLookupQuery(query, memory)) continue;
    if (containsText(query, normalized) && (containsText(title, normalized) || containsText(content, normalized))) {
      score += normalized.length <= 2 ? 1 : 8;
      matched = true;
      direct = true;
      explicit = true;
      strongDirect = true;
    }
  }

  if (dateCueMatches(query, memory.event_date)) {
    matches.push({ kind: "date", term: memory.event_date });
    score += 24;
    matched = true;
    direct = true;
    explicit = true;
    strongDirect = true;
  }

  const semanticAliases = scoreSemanticAliases(memory, query);
  if (semanticAliases.matched) {
    matches.push({ kind: "concept-alias" });
    score += semanticAliases.score;
    matched = true;
    // Concept aliases are discovery hints. They never prove that the memory
    // directly answers the live query, even when the alias occurs in a title.
  }

  const fuzzyCue = allowFuzzy ? fuzzyMetadataCue(memory, query) : null;
  if (!matched && fuzzyCue) {
    matches.push({ kind: "fuzzy-metadata", term: fuzzyCue });
    score += 6;
    matched = true;
    // Spelling similarity discovers candidates; it never establishes authority.
  }

  const prepared = queryFeatures || lexicalQueryFeatures(query);
  const atomHits = new Set();
  for (const atom of prepared.atoms) {
    if (!containsText(canonicalHaystack, atom)) continue;
    matches.push({ kind: "atom", term: atom });
    score += atom.length >= 4 ? 6 : atom.length === 3 ? 4 : 3;
    atomHits.add(atom);
    matched = true;
    direct = true;
    explicit = true;
  }

  const wordHits = new Set();
  for (const term of prepared.words) {
    if (atomHits.has(term)) continue;
    if (!haystackWords.has(term)) continue;
    matches.push({ kind: "word", term });
    score += term.length >= 4 ? 4 : 3;
    wordHits.add(term);
    matched = true;
    if (titleWords.has(term) || metadataWords.has(term)) explicit = true;
  }

  const queryTerms = prepared.terms.filter((term) => !atomHits.has(term) && !wordHits.has(term));
  const fragmentsMayScore = prepared.fragmentsMayStart || matched || allowFragmentOnly;
  for (const term of queryTerms) {
    if (fragmentsMayScore && haystackTerms.has(term)) {
      matches.push({ kind: "fragment", term });
      score += term.length >= 4 ? 4 : term.length === 3 ? 3 : 1;
      matched = true;
    }
  }
  return { score: matched ? score : 0, direct, explicit, strongDirect, matches };
}


function tokenize(value) {
  const normalized = normalize(value);
  const terms = normalized.match(/[a-z0-9_-]{2,}|[\u3400-\u9fff]{2,}/g) || [];
  const output = new Set(terms);
  for (const term of terms) {
    if (!/[\u3400-\u9fff]/.test(term)) continue;
    for (let index = 0; index < term.length - 1; index += 1) output.add(term.slice(index, index + 2));
    for (let index = 0; index < term.length - 2; index += 1) output.add(term.slice(index, index + 3));
  }
  return [...output];
}

function queryAtoms(value) {
  return normalize(value).match(/[a-z0-9_-]{2,}|[\u3400-\u9fff]{2,}/g) || [];
}

export function lexicalWords(value) {
  return [...WORD_SEGMENTER.segment(normalize(value))]
    .filter((item) => item.isWordLike)
    .map((item) => item.segment);
}

function sanitizeQueryForTokens(value) {
  let sanitized = normalize(value);
  for (const phrase of QUERY_NOISE_PHRASES) sanitized = sanitized.split(phrase).join(" ");
  return sanitized.replace(/\s+/g, " ").trim();
}


export function scoreContextualEvidence(memory, envelope, scorer = scoreMemoryDetailed) {
  if (!envelope.present || !envelope.hypotheses.length) {
    return { score: 0, direct: false, contextual: false };
  }
  let best = { score: 0, direct: false, contextual: false };
  for (const hypothesis of envelope.hypotheses) {
    const contextualQuery = contextualEvidenceHardeningEnabled()
      ? sanitizeContextHypothesis(hypothesis, envelope.entities)
      : hypothesis;
    const evidence = scorer(memory, contextualQuery, { allowFragmentOnly: true, allowFuzzy: false });
    if (contextualEvidenceHardeningEnabled()) evidence.direct = false;
    if (evidence.score > best.score || (evidence.score === best.score && evidence.direct && !best.direct)) {
      best = { ...evidence, contextual: evidence.score > 0 };
    }
  }
  return best;
}

export function sanitizeContextHypothesis(value, entities = []) {
  let sanitized = normalize(value);
  for (const phrase of CONTEXT_NOISE_PHRASES) sanitized = sanitized.split(phrase).join(" ");
  for (const entity of entities) {
    const normalizedEntity = normalize(entity);
    if (normalizedEntity) sanitized = sanitized.split(normalizedEntity).join(" ");
  }
  return sanitized.replace(/[^a-z0-9_\-\u3400-\u9fff]+/gi, " ").replace(/\s+/g, " ").trim();
}

export function resolveRecallEvidence(rawEvidence, contextualEvidence) {
  const rawScore = Number(rawEvidence?.score) || 0;
  const contextualScore = Number(contextualEvidence?.score) || 0;
  const useContext = contextualScore >= MIN_RELEVANCE_SCORE && contextualScore > rawScore;
  const agreementBonus = rawScore >= MIN_RELEVANCE_SCORE && contextualScore >= MIN_RELEVANCE_SCORE
    ? Math.min(4, Math.min(rawScore, contextualScore) / 3)
    : 0;
  return {
    discoveryScore: Math.max(rawScore, contextualScore) + agreementBonus,
    answerScore: rawScore >= MIN_RELEVANCE_SCORE
      ? rawScore + agreementBonus
      : contextualScore,
    direct: useContext ? Boolean(contextualEvidence.direct) : Boolean(rawEvidence.direct),
    contextual: useContext,
  };
}


function isIdentityLookupQuery(query, memory) {
  if (deepCategory(memory) !== "identity") return false;
  return /(?:是谁|身份|名字|基本资料|介绍|profile)/i.test(query)
    || [...GENERIC_IDENTITY_CUES].some((cue) => query === cue);
}


export function createEvidenceScorer() {
  const cache = new WeakMap();
  const queries = new Map();
  return (memory, query, options = {}) => {
    if (!cache.has(memory)) cache.set(memory, { features: memoryLexicalFeatures(memory), scores: new Map() });
    const cached = cache.get(memory);
    const queryKey = JSON.stringify([normalize(query), Boolean(options.allowFragmentOnly), options.allowFuzzy !== false]);
    if (!cached.scores.has(queryKey)) {
      if (!queries.has(queryKey)) queries.set(queryKey, lexicalQueryFeatures(query));
      cached.scores.set(queryKey, scoreMemoryDetailed(memory, query, {
        ...options, features: cached.features, queryFeatures: queries.get(queryKey),
      }));
    }
    // Context hardening may adjust the returned flags, not the cached evidence.
    return { ...cached.scores.get(queryKey) };
  };
}

function lexicalQueryFeatures(rawQuery) {
  const query = normalize(rawQuery);
  const relativeTail = relativeTailFilterEnabled();
  const wordEvidence = lexicalEvidenceV2Enabled();
  const text = relativeTail ? sanitizeQueryForTokens(query) : query;
  return {
    atoms: relativeTail ? queryAtoms(text) : [],
    words: wordEvidence ? lexicalWords(text).filter((term) => term.length >= 2 && !GENERIC_QUERY_TERMS.has(term)) : [],
    terms: tokenize(text).filter((term) => !GENERIC_QUERY_TERMS.has(term)),
    fragmentsMayStart: !wordEvidence,
  };
}

function normalizedPhrases(phrases) {
  return [...phrases].map(normalize).filter(Boolean).sort((a, b) => b.length - a.length);
}

function memoryLexicalFeatures(memory) {
  const ordinaryAmbientTriggers = memory.ambient_triggers.filter((trigger) => !normalize(trigger).startsWith("signal:"));
  const title = normalize(memory.title);
  const content = normalize(memory.content);
  const metadata = normalize([...(memory.tags || []), ...memory.triggers, ...ordinaryAmbientTriggers].join(" "));
  const canonicalHaystack = `${title} ${metadata} ${content}`;
  const titleWords = new Set(lexicalWords(title));
  const metadataWords = new Set(lexicalWords(metadata));
  return { ordinaryAmbientTriggers, title, content, canonicalHaystack, titleWords, metadataWords,
    haystackWords: new Set([...titleWords, ...metadataWords, ...lexicalWords(content)]),
    haystackTerms: new Set(tokenize(canonicalHaystack)) };
}
