import { normalize, clamp } from "./runtime.js";
import { memorySummary } from "../memory-summary.js";
import { projectMemoryCard } from "../memory-card.js";
import { containsText } from "../lib/text-match.js";

export function summarize(memory, score, {
  matchReason: reason = "relevant", recommendedMode: mode = "summary", alreadyRecentlyRead = false,
  navigation = null, arcMemberships = null, entities = [],
} = {}) {
  const representation = recallRepresentation(memory);
  return {
    ...projectMemoryCard(memory, { excerpt: excerpt(representation.content), navigation: arcMemberships?.length ? navigation : null }),
    representation: memory.public_projection_only ? "public_projection" : representation.kind,
    tags: memory.tags, triggers: memory.triggers, ambient_triggers: memory.ambient_triggers,
    layer: memory.layer, importance: memory.importance, policy_origin: memory.policy_origin,
    supersedes_id: memory.supersedes_id, match_reason: reason, recommended_mode: mode,
    already_recently_read: alreadyRecentlyRead,
    arc_memberships: arcMemberships, arc_membership_coverage: arcMemberships ? "bounded-membership-query" : "not-requested", entities,
    source: { file: memory.source_file, section: memory.source_section, external_id: memory.external_id },
    observance: memory.month_day || memory.exact_date ? {
      label: memory.label, exact_date: memory.exact_date || null,
      month_day: memory.month_day || null, recurring: Boolean(memory.recurring),
    } : null,
    score: Math.round(score * 100) / 100,
  };
}

export function recallRepresentation(memory) {
  return memorySummary(memory)
    ? { kind: "summary", content: memorySummary(memory) }
    : { kind: "canonical", content: String(memory.content || "") };
}

export function fullMemory(memory, { score, matchReason: reason, recommendedMode: mode }) {
  const representation = recallRepresentation(memory);
  return {
    ...summarize(memory, score, { matchReason: reason, recommendedMode: mode }),
    content: representation.content,
    detail_level: representation.kind === "summary" ? "summary" : "full",
    canonical_content_available: true,
  };
}

export function deepToSummary(item) {
  const { content, ...summary } = item;
  return { ...summary, excerpt: excerpt(content) };
}

export function anchor(memory, score) {
  return {
    id: memory.id,
    title: memory.title,
    cue: memory.triggers[0] || memory.ambient_triggers[0] || memory.title,
    family_key: memory.family_key,
    content_hash: memory.content_hash,
    sensitivity: memory.sensitivity,
    mentionability: memory.mentionability,
    version: memory.version,
    score: Math.round(score * 100) / 100,
  };
}

export function deepCategory(memory) {
  const text = `${memory.kind} ${memory.title} ${memory.tags.join(" ")}`;
  if (memory.kind === "profile" || /(身份|名字|我们是谁|基本资料)/.test(text)) return "identity";
  if (memory.kind === "handoff" || /(窗口尾页|交接|下一步)/.test(text)) return "handoff";
  if (/(agreement|约定|协议|誓约|盟誓)/i.test(text)) return "agreement";
  if (memory.layer === "context" || /(项目|计划|升级|正在进行)/.test(text)) return "project";
  return "other";
}

export function matchReason(memory, query, { contextualMatch = false } = {}) {
  if (contextualMatch) return "context-hypothesis-match";
  const normalized = normalize(query);
  if (!normalized) return memory.layer === "core" ? "core-priority" : "recency-rotation";
  if (containsText(memory.title, normalized)) return "title-match";
  if ([...memory.triggers, ...memory.ambient_triggers].some((trigger) => containsText(normalized, trigger))) return "trigger-match";
  return "semantic-overlap";
}

export function recommendedMode(memory, query) {
  if (normalize(memory.title) === normalize(query)) return "deep";
  if (memory.kind === "intimate-agreement" || memory.load_policy === "manifest-always") return "manifest";
  return "summary";
}

export function mentionabilityBoost(memory) {
  if (memory.mentionability === "natural") return 3;
  if (memory.mentionability === "contextual") return 1;
  return 0;
}

export function importanceBoost(memory) {
  return clamp(memory.importance, 0, 100) / 25;
}

export function evergreenPriorityBoost(memory) {
  if (memory.kind === "intimate-agreement" || memory.load_policy === "manifest-always") return 24;
  if (memory.layer !== "core") return 0;
  if (["agreement", "identity"].includes(deepCategory(memory))) return 18;
  if (memory.kind === "anchor" || memory.kind === "procedural") return 14;
  return 0;
}


export function excerpt(content, max = 360) {
  const compact = String(content).replace(/\s+/g, " ").trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}
