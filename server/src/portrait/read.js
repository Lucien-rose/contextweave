import { parseContract } from "../lib/contract.js";
import { portraitReadSchema } from "./contract.js";
import { listPortraitItems, portraitContent, portraitEvidence, portraitHash, portraitRevision } from "./store.js";
import { serializedChars } from "../recall/response-budget.js";

export function portraitVisible(item, { context, intimacy_mode }) {
  if (context === "general") return false;
  return item.sensitivity !== "intimate" || ["proactive", "scene", "on"].includes(intimacy_mode);
}

export function activePortraitItems(db, request, at = new Date()) {
  return listPortraitItems(db, request.subject_id || "user").filter((item) => item.status === "active"
    && (!item.expires_at || Date.parse(item.expires_at) > at.getTime()) && portraitVisible(item, request));
}

export function readPortrait(db, rawInput = {}, { at = new Date() } = {}) {
  const input = parseContract(portraitReadSchema, rawInput);
  const active = input.include_inactive ? listPortraitItems(db, input.subject_id)
    .filter((item) => portraitVisible(item, input)) : activePortraitItems(db, input, at);
  const candidates = active.filter((item) => (!input.domains.length || input.domains.includes(item.domain))
    && (!input.item_ids.length || input.item_ids.includes(item.id))
    && (!input.time_scales.length || input.time_scales.includes(item.time_scale)))
    .map((item) => ({ item, score: profileQueryScore(input.query, `${item.title} ${item.content}`) }))
    .filter(({ score }) => !input.query || score > 0 || input.item_ids.length || input.domains.length)
    .sort((a, b) => b.score - a.score || b.item.priority - a.item.priority || a.item.id.localeCompare(b.item.id))
    .map(({ item }) => item);
  const output = { subject_id: input.subject_id, revision: input.context === "general" ? 0 : portraitRevision(db, input.subject_id),
    items: [], content_hash: "0".repeat(64), truncated: false,
    budget: { max_chars: input.max_chars, used_chars: input.max_chars } };
  for (const item of candidates) {
    const view = { id: item.id, ...portraitContent(item), revision: item.revision, content_hash: item.content_hash,
      confidence: item.confidence, expires_at: item.expires_at, last_confirmed_at: item.last_confirmed_at,
      ...(input.include_evidence ? { source_refs: portraitEvidence(db, item.subject_id, item.id) } : {}) };
    output.items.push(view);
    if (serializedChars(output) > input.max_chars) {
      output.items.pop();
      output.truncated = true;
    }
  }
  output.content_hash = portraitHash(output.items);
  output.budget.used_chars = serializedChars(output);
  output.budget.used_chars = serializedChars(output);
  return output;
}

function profileQueryScore(query, text) {
  const lower = text.normalize("NFKC").toLowerCase();
  const normalized = query.normalize("NFKC").toLowerCase();
  const tokens = new Set(normalized.match(/[a-z0-9_]{2,}/gu) || []);
  for (const run of normalized.match(/[\p{Script=Han}]+/gu) || []) {
    for (let index = 0; index < run.length - 1; index++) tokens.add(run.slice(index, index + 2));
  }
  return [...tokens].reduce((score, token) => score + Number(lower.includes(token)), 0);
}

export function buildPortraitSeed(db, request, { maxChars = 5000, at = new Date() } = {}) {
  const items = activePortraitItems(db, request, at).filter((item) => item.time_scale === "stable" && item.seed_eligible);
  const parts = [];
  const ids = [];
  const seen = new Set();
  for (const item of items) {
    const text = `${item.title}：${item.content}`;
    if (seen.has(item.content)) continue;
    parts.push(text);
    ids.push(item.id);
    if (serializedChars({ content: parts.join("\n"), content_hash: "0".repeat(64), item_ids: ids, use_policy: "silent" }) > maxChars) {
      parts.pop();
      ids.pop();
      continue;
    }
    seen.add(item.content);
  }
  const content = parts.join("\n");
  return { content, content_hash: portraitHash(content), item_ids: ids, use_policy: "silent" };
}
