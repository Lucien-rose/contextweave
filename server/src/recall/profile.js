import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const EMPTY_PROFILE = Object.freeze({
  identity_cues: [],
  generic_query_terms: [],
  context_evidence_phrases: [],
  query_aliases: {},
  semantic_groups: [],
  fuzzy_cues: [],
  classification_anchors: [],
  classification_core_terms: [],
  classification_priority_anchors: [],
  birthday_title: "Birthday",
});

let cache = { path: null, stamp: null, profile: EMPTY_PROFILE };

export function recallProfileFile() {
  return process.env.MOSS_RECALL_PROFILE_FILE ? resolve(process.env.MOSS_RECALL_PROFILE_FILE) : null;
}

export function recallProfile() {
  const path = recallProfileFile();
  if (!path || !existsSync(path)) return EMPTY_PROFILE;
  const stat = statSync(path);
  const stamp = `${stat.mtimeMs}:${stat.size}`;
  if (cache.path === path && cache.stamp === stamp) return cache.profile;
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const profile = normalizeProfile(parsed);
  cache = { path, stamp, profile };
  return profile;
}

function normalizeProfile(input) {
  const object = input && typeof input === "object" ? input : {};
  return Object.freeze({
    identity_cues: strings(object.identity_cues),
    generic_query_terms: strings(object.generic_query_terms),
    context_evidence_phrases: strings(object.context_evidence_phrases),
    query_aliases: aliases(object.query_aliases),
    semantic_groups: groups(object.semantic_groups),
    fuzzy_cues: strings(object.fuzzy_cues),
    classification_anchors: strings(object.classification_anchors),
    classification_core_terms: strings(object.classification_core_terms),
    classification_priority_anchors: strings(object.classification_priority_anchors),
    birthday_title: String(object.birthday_title || "Birthday").trim().slice(0, 120) || "Birthday",
  });
}

function strings(value) {
  return Object.freeze(Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
    : []);
}

function groups(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.map(strings).filter((group) => group.length >= 2));
}

function aliases(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({});
  return Object.freeze(Object.fromEntries(Object.entries(value)
    .map(([key, items]) => [String(key || "").trim(), strings(items)])
    .filter(([key, items]) => key && items.length)));
}
