import { recallProfile } from "./profile.js";
import { containsText } from "../lib/text-match.js";

const LOCAL_PROFILE = recallProfile();

const SEMANTIC_GROUPS = [
  ["记忆网关", "memory gateway", "网关"],
  ["接力", "交接", "handoff", "续接", "连续性"],
  ["双端", "两端", "跨端", "多端"],
  ["原文", "原话", "逐字", "原始消息", "聊天原文"],
  ["归档", "档案", "archive"],
  ...LOCAL_PROFILE.semantic_groups,
];

const GENERIC_FUZZY_CUES = new Set([
  "我们", "你们", "他们", "先生", "小姐", "记忆", "回忆", "内容", "事情",
  ...LOCAL_PROFILE.fuzzy_cues,
]);
const QUESTION_TEMPLATE = /什么|怎么|怎样|哪里|哪儿|为何|为什么|是否|吗|呢/;
const SEMANTIC_DISCOVERY_WEIGHT = Object.freeze({ title: 6, content: 2, metadata: 1 });

export function scoreSemanticAliases(memory, query) {
  const haystacks = {
    title: normalize(memory.title),
    metadata: normalize([...memory.tags, ...memory.triggers, ...memory.ambient_triggers].join(" ")),
    content: normalize(memory.content),
  };
  let score = 0;
  for (const aliases of discoveryAliasGroups(query)) {
    if (aliases.some((term) => containsText(haystacks.title, term))) score += SEMANTIC_DISCOVERY_WEIGHT.title;
    else if (aliases.some((term) => containsText(haystacks.content, term))) score += SEMANTIC_DISCOVERY_WEIGHT.content;
    else if (aliases.some((term) => containsText(haystacks.metadata, term))) score += SEMANTIC_DISCOVERY_WEIGHT.metadata;
  }
  return { score, matched: score > 0 };
}

export function semanticCueAliases(query) {
  return [...new Set(discoveryAliasGroups(normalize(query)).flat())];
}

function discoveryAliasGroups(query) {
  const groups = SEMANTIC_GROUPS.map((group) => group.map(normalize))
    .filter((group) => group.some((term) => containsText(query, term)))
    .map((group) => group.filter((term) => !containsText(query, term)));
  // Personalized query aliases retain their original direction; broadening a
  // cue into candidates must not silently make every alias a reverse trigger.
  for (const [needle, aliases] of Object.entries({ "生日": ["生日", "诞生日", "出生"], ...LOCAL_PROFILE.query_aliases })) {
    if (containsText(query, normalize(needle))) groups.push(aliases.map(normalize).filter((term) => !containsText(query, term)));
  }
  return groups;
}

export function fuzzyMetadataCue(memory, query) {
  const compactQuery = compact(query);
  if (!compactQuery) return null;
  const queryWords = latinWords(query);
  const cues = [memory.title, ...memory.tags, ...memory.triggers, ...memory.ambient_triggers]
    .map((value) => ({ text: normalize(value), compact: compact(value) }))
    .filter((cue) => cue.compact.length >= 3 && cue.compact.length <= 24
      && !GENERIC_FUZZY_CUES.has(cue.compact) && !QUESTION_TEMPLATE.test(cue.compact));
  return cues.find((cue) => {
    // English phrases retain each word boundary; Han cues keep their existing
    // character tolerance. Mixed-script cues require exact evidence elsewhere.
    if (/^[a-z0-9\s'-]+$/.test(cue.text)) {
      return fuzzyWordSequence(queryWords, latinWords(cue.text));
    }
    return /^[\u3400-\u9fff]+$/.test(cue.compact)
      && withinOneSubstitution(compactQuery, cue.compact);
  })?.compact || null;
}

function latinWords(value) {
  return normalize(value).match(/[\p{Script=Latin}\p{N}_]+(?:['’][\p{Script=Latin}\p{N}_]+)*/gu) || [];
}

function fuzzyWordSequence(query, cue) {
  if (!cue.length) return false;
  for (let start = 0; start <= query.length - cue.length; start += 1) {
    let differences = 0;
    for (let index = 0; index < cue.length; index += 1) {
      const word = query[start + index];
      if (word === cue[index]) continue;
      if (word.length !== cue[index].length || !/^[a-z]+$/.test(word)
        || !withinOneSubstitution(word, cue[index])) {
        differences = 2;
        break;
      }
      differences += 1;
      if (differences > 1) break;
    }
    if (differences === 1) return true;
  }
  return false;
}

export function dateCueMatches(query, eventDate) {
  if (!eventDate) return false;
  const match = String(eventDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match;
  const monthNumber = String(Number(month));
  const dayNumber = String(Number(day));
  const variants = [
    `${year}-${month}-${day}`,
    `${year}/${month}/${day}`,
    `${year}年${monthNumber}月${dayNumber}日`,
  ];
  return variants.some((value) => query.includes(normalize(value)));
}

function withinOneSubstitution(haystack, needle) {
  if (haystack.includes(needle)) return false;
  if (haystack.length < needle.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let differences = 0;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] === needle[offset]) continue;
      // Numerals identify different dates/versions rather than a spelling variant.
      if (/[0-9]/.test(haystack[start + offset] + needle[offset])) {
        differences = 2;
        break;
      }
      differences += 1;
      if (differences > 1) break;
    }
    if (differences === 1) return true;
  }
  return false;
}

function compact(value) {
  return normalize(value).replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}

function normalize(value) {
  return String(value || "").normalize("NFKC").toLowerCase();
}
