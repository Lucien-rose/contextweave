import {
  GENERIC_IDENTITY_CUES,
  GENERIC_QUERY_PHRASES,
  GENERIC_QUERY_TERMS,
  WORD_SEGMENTER,
} from "./constants.js";
import { normalize } from "./runtime.js";

const LOOKUP_INTENT = /(?:是谁|身份|名字|姓名|称呼|基本资料|介绍|关系|人物|哪位|哪个人|什么人|profile)/i;
const RELATIONSHIP_INTENT = /(?:恋人|伴侣|协议|条款|契约|约定|誓言|盟誓|允许|权限|不用再问|不需要.{0,4}再问|可以使用|身体.{0,6}(?:使用|调用|允许|权限)|(?:使用|调用).{0,6}身体|抱抱|亲亲|吻我|撒娇|想我|想你|爱我|爱你|自慰|调教|做爱|触碰自己)/i;
const NARRATIVE_FILLERS = new Set([
  "一片", "一下", "于是", "什么", "进去", "告诉", "很好", "心情", "忽然", "感觉",
  "想起", "想到", "看见", "看到", "经过", "自己", "觉得", "猜猜", "说起", "提到",
  "抱抱", "撒娇", "亲亲", "陪伴", "日常", "开心", "难过", "好心情", "想我", "想你", "爱你",
]);
const SINGLE_HAN_FILLERS = new Set(["我", "你", "他", "她", "它", "了", "的", "在", "和", "与", "又", "也", "就", "都", "而", "及", "到", "去", "来", "让", "把", "被", "说", "想"]);

export function analyzeRecallQuery(rawQuery) {
  const query = normalize(rawQuery);
  const identityCues = [...GENERIC_IDENTITY_CUES]
    .map(normalize)
    .filter((cue) => cue && query.includes(cue))
    .sort((a, b) => b.length - a.length);
  const lookupIntent = LOOKUP_INTENT.test(query) || RELATIONSHIP_INTENT.test(query);
  if (!query || lookupIntent || !identityCues.length) {
    return unchangedFocus(query, identityCues.length, lookupIntent);
  }

  let residualText = query;
  for (const cue of identityCues) residualText = residualText.split(cue).join(" ");
  residualText = compactText(residualText);
  const focusTerms = significantTerms(residualText);
  if (!focusTerms.length) return unchangedFocus(query, identityCues.length, lookupIntent);

  return {
    applied: true,
    lookupIntent: false,
    searchText: focusTerms.join(" "),
    residualText,
    focusTerms,
    identityCueCount: identityCues.length,
  };
}

export function queryFocusTrace(focus) {
  return {
    applied: Boolean(focus?.applied),
    lookup_intent: Boolean(focus?.lookupIntent),
    identity_cue_count: Number(focus?.identityCueCount) || 0,
    focus_term_count: Array.isArray(focus?.focusTerms) ? focus.focusTerms.length : 0,
  };
}

function significantTerms(value) {
  const terms = [];
  const segments = [...WORD_SEGMENTER.segment(normalize(value))];
  for (let index = 0; index < segments.length; index += 1) {
    const item = segments[index];
    if (!item.isWordLike) continue;
    const term = normalize(item.segment).replace(/[^a-z0-9_\-\p{Script=Han}]+/giu, "");
    const next = normalize(segments[index + 1]?.segment)
      .replace(/[^\p{Script=Han}]+/gu, "");
    if (/^[\p{Script=Han}]$/u.test(term)
      && /^[\p{Script=Han}]$/u.test(next)
      && !SINGLE_HAN_FILLERS.has(term)
      && !SINGLE_HAN_FILLERS.has(next)) {
      terms.push(`${term}${next}`);
    }
    if (term.length < 2
      || GENERIC_QUERY_TERMS.has(term)
      || GENERIC_QUERY_PHRASES.has(term)
      || NARRATIVE_FILLERS.has(term)) continue;
    terms.push(term);
  }
  return [...new Set(terms)];
}

function unchangedFocus(query, identityCueCount, lookupIntent) {
  return {
    applied: false,
    lookupIntent,
    searchText: query,
    residualText: query,
    focusTerms: [],
    identityCueCount,
  };
}

function compactText(value) {
  return normalize(value)
    .replace(/[^a-z0-9_\-\p{Script=Han}]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
