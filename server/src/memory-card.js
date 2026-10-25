import { memorySummary, summaryRecommended } from "./memory-summary.js";

// Shared projection, not another source of truth. Text is supplied once by the
// caller after policy/summary/chunk selection; owner reads keep their full body.
export function projectMemoryCard(memory, { content, excerpt, detailLevel = "summary", navigation = null, ...extra } = {}) {
  return {
    schema_version: "memory-card-v1",
    id: memory.id, title: memory.title, kind: memory.kind,
    ...(content !== undefined ? { content } : {}),
    ...(excerpt !== undefined ? { excerpt } : {}),
    representation: memory.public_projection_only ? "public_projection"
      : detailLevel === "summary" && memorySummary(memory) ? "summary" : "canonical",
    detail_level: memory.public_projection_only ? "public_projection" : detailLevel,
    summary_available: Boolean(memorySummary(memory)), summary_recommended: summaryRecommended(memory),
    event_date: memory.event_date, family_key: memory.family_key, content_hash: memory.content_hash,
    ...(memory.family_branch_key ? { family_branch_key: memory.family_branch_key } : {}),
    version: memory.version, status: memory.status,
    sensitivity: memory.sensitivity, mentionability: memory.mentionability,
    load_policy: memory.load_policy, standing_opt_in: memory.standing_opt_in,
    scope: memory.scope, activation_policy: memory.activation_policy, egress_policy: memory.egress_policy,
    expandable: !memory.public_projection_only, canonical_content_available: !memory.public_projection_only,
    read_via: memory.public_projection_only ? null
      : { tool: "moss_read", arguments: { memory_id: memory.id } },
    relations_via: memory.public_projection_only || !navigation || navigation.context === "general" ? null : {
      tool: "moss_relation_paths", arguments: { seed: { type: "memory", id: memory.id },
        context: navigation.context, intimacy_mode: navigation.intimacyMode, namespace: navigation.namespace || "real",
        ...(navigation.asOf ? { as_of: navigation.asOf } : {}) },
    },
    ...extra,
  };
}

export function ownerMemoryCard(memory) {
  const { tags_json, triggers_json, ambient_triggers_json, ...record } = memory;
  return { ...record, ...projectMemoryCard(memory, { content: memory.content, detailLevel: "full" }) };
}

