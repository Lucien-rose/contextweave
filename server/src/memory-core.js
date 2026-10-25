import { createHash, randomUUID } from "node:crypto";
import { clampScore } from "./lib/number.js";
import {
  archiveMemory,
  audit,
  createMemoryCandidate,
  getMemory,
  getMemoryCandidate,
  getMemoryCandidateByFingerprint,
  listMemoriesForAdmin,
  listMemoryCandidates,
  memoryPolicyAudit,
  memoryStats,
  updateMemoryCandidate,
  writeMemory,
} from "./database.js";
import { commitDraftMemory } from "./memory-commit.js";
import { appendMemoryEvidence } from "./memory-evidence.js";
import { readMemoryTimeline } from "./memory-timeline.js";
import { candidateDefaults, evaluateMemoryCandidate } from "./memory-policy.js";
import { memoriesForDate, recallMemories, recallMemoriesWithTrace } from "./retrieval.js";
import { bootstrapForDelivery, todayForDelivery, recallForDelivery, recallForDeliveryWithVector, acknowledgeRecallDelivery } from "./recall/delivery.js";
import { vectorRuntimeStatus } from "./vector-retrieval.js";
import { progressiveRecall } from "./recall/sqlite.js";
import { recallWithJevShadow } from "./recall/jev-shadow.js";
import { expandRecallMemory } from "./recall/expand.js";
import { applyMemoryIntent } from "./evolution/changes.js";
import { classifyLifecycleMemory } from "./lifecycle-classification.js";
import { curateSourceContext, readOwnerSourceContext, readSourceContext } from "./source-context.js";
import { sourceMaterialStats } from "./source-materials.js";
import { withRecallSettings } from "./recall/settings.js";
import { maintainMemoryWrite } from "./memory-write.js";

export function createMemoryCore(db) {
  const policy = (input) => withRecallSettings(db, input);
  return {
    bootstrap: (input) => bootstrapForDelivery(db, policy(input)),
    recall: (input) => recallMemories(db, policy(input)),
    recallWithTrace: (input) => recallMemoriesWithTrace(db, policy(input)),
    recallWithVectorTrace: (input = {}) => (input.jevShadowMode === "observe" ? recallWithJevShadow : progressiveRecall)(db, {
      ...policy(input),
      vectorMode: input.vectorMode || null,
      syncIndex: false,
    }),
    recallForDeliveryLegacy: (input) => recallForDelivery(db, policy(input)),
    recallForDelivery: (input) => recallForDeliveryWithVector(db, policy(input)),
    vectorStatus: (input) => vectorRuntimeStatus(db, input),
    acknowledgeDelivery: (input) => acknowledgeRecallDelivery(db, input),
    today: (input) => memoriesForDate(db, policy(input)),
    todayForDelivery: (input) => todayForDelivery(db, policy(input)),
    read: (id) => getMemory(db, id),
    sourceContext: (input) => readSourceContext(db, policy(input)),
    ownerSourceContext: (input) => readOwnerSourceContext(db, input),
    curateSourceContext: (input) => curateSourceContext(db, input),
    expand: (input) => expandRecallMemory(db, policy(input)),
    timeline: (id) => readMemoryTimeline(db, id, (memoryId) => getMemory(db, memoryId)),
    list: (input) => listMemoriesForAdmin(db, input),
    stats: () => ({ ...memoryStats(db), provenance: sourceMaterialStats(db) }),
    policyAudit: () => memoryPolicyAudit(db),
    draft: (memory) => draftMemory(db, memory),
    commit: (id) => commitDraftMemory(db, id),
    async commitWithFamily(id) {
      const memory = commitDraftMemory(db, id);
      if (!memory) return { memory, family_judgment: null };
      return { memory, ...await maintainMemoryWrite(db, memory.id) };
    },
    archive: (id) => archiveMemory(db, id),
    candidates: (input) => listMemoryCandidates(db, input),
    candidate: (id) => getMemoryCandidate(db, id),
    ingestCandidate: (input) => ingestMemoryCandidate(db, input),
    async ingestCandidateWithFamily(input) {
      const outcome = ingestMemoryCandidate(db, input);
      if (!outcome.memory || outcome.duplicate) return outcome;
      return { ...outcome, ...await maintainMemoryWrite(db, outcome.memory.id) };
    },
  };
}

export function draftMemory(db, memory) {
  const { source_refs: sourceRefs = [], ...fields } = memory;
  let draft = writeMemory(db, {
    ...fields,
    id: fields.id || `draft:${randomUUID()}`,
    status: "draft",
  });
  appendMemoryEvidence(db, draft.id, sourceRefs);
  draft = getMemory(db, draft.id);
  audit(db, draft.id, "draft", draft);
  return draft;
}

export function ingestMemoryCandidate(db, rawInput) {
  const input = normalizeCandidate(rawInput);
  const existing = getMemoryCandidateByFingerprint(db, input.fingerprint);
  if (existing) {
    const refreshed = createMemoryCandidate(db, {
      ...input,
      id: existing.id,
      policy_decision: existing.policy_decision,
      policy_reasons: existing.policy_reasons,
      status: existing.status,
      memory_id: existing.memory_id,
      processed_at: existing.processed_at,
      created_at: existing.created_at,
    });
    if (refreshed.memory_id) appendMemoryEvidence(db, refreshed.memory_id, refreshed.source_refs);
    return {
      candidate: refreshed,
      memory: refreshed.memory_id ? getMemory(db, refreshed.memory_id) : null,
      duplicate: true,
      requires_confirmation: refreshed.policy_decision === "confirm",
    };
  }

  const policy = evaluateMemoryCandidate(input);
  const initialStatus = {
    "auto-save": "pending",
    confirm: "pending",
    review: "review",
    ignore: "ignored",
  }[policy.decision];
  let candidate = createMemoryCandidate(db, {
    ...input,
    policy_decision: policy.decision,
    policy_reasons: policy.reasons,
    status: initialStatus,
  });
  if (!candidate) throw new Error("Unable to persist memory candidate");

  if (policy.decision === "auto-save") {
    const target = candidate.base_memory_id ? getMemory(db, candidate.base_memory_id) : null;
    const intent = intentFromCandidate(candidate, target);
    const outcome = applyMemoryIntent(db, intent);
    if (outcome.status !== "applied") {
      candidate = updateMemoryCandidate(db, candidate.id, { status: "review" });
      return { candidate, memory: null, duplicate: false, requires_confirmation: false,
        review_reason: outcome.reason };
    }
    const memory = getMemory(db, outcome.memory_id);
    candidate = updateMemoryCandidate(db, candidate.id, {
      status: "saved",
      memory_id: memory.id,
      processed_at: new Date().toISOString(),
    });
    return { candidate, memory, duplicate: false, requires_confirmation: false };
  }

  if (policy.decision === "confirm") {
    candidate = updateMemoryCandidate(db, candidate.id, { status: "review" });
    return { candidate, memory: null, duplicate: false, requires_confirmation: true };
  }

  return { candidate, memory: null, duplicate: false, requires_confirmation: false };
}

function normalizeCandidate(input) {
  const candidateKind = String(input.candidate_kind || "").trim();
  const defaults = candidateDefaults(candidateKind);
  const title = requiredText(input.title, "title", 160);
  const content = requiredText(input.content, "content", 50_000);
  const eventDate = input.event_date || null;
  if (eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw new TypeError("event_date must use YYYY-MM-DD");
  const sourceRefs = normalizeSourceRefs(input.source_refs);
  const safeProjection = optionalText(input.safe_projection, 5000);
  const recallSummary = optionalText(input.recall_summary ?? input.safe_projection, 5000);
  const publicProjection = optionalText(input.public_projection, 5000);
  const canonical = JSON.stringify({
    candidate_kind: candidateKind,
    title: title.normalize("NFKC").trim(),
    content: content.normalize("NFKC").trim(),
    safe_projection: safeProjection,
    recall_summary: recallSummary,
    public_projection: publicProjection,
    event_date: eventDate,
  });
  return {
    id: `candidate:${randomUUID()}`,
    candidate_kind: candidateKind,
    title,
    content,
    safe_projection: safeProjection,
    recall_summary: recallSummary,
    public_projection: publicProjection,
    event_date: eventDate,
    tags: cleanStrings(input.tags, 30, 80),
    triggers: cleanStrings(input.triggers, 30, 120),
    sensitivity: ["personal", "private", "sensitive", "intimate"].includes(input.sensitivity)
      ? input.sensitivity : defaults.sensitivity,
    mentionability: ["natural", "contextual", "explicit-only"].includes(input.mentionability)
      ? input.mentionability : defaults.mentionability,
    importance: clampInteger(input.importance ?? 60, 0, 100),
    confidence: clampScore(input.confidence),
    meaning_score: clampScore(input.meaning_score),
    source_refs: sourceRefs,
    base_memory_id: input.base_memory_id || null,
    fingerprint: createHash("sha256").update(canonical, "utf8").digest("hex"),
  };
}

function intentFromCandidate(candidate, target) {
  const lifecycleClass = candidateLifecycleClass(candidate.candidate_kind);
  const operation = lifecycleClass === "episode"
    ? "append_episode"
    : target
    ? (candidate.candidate_kind === "correction" ? "correct" : "supersede")
    : "create";
  const targetRequired = ["correct", "supersede"].includes(operation);
  return {
    change_id: `gateway:${candidate.id}`,
    operation,
    authority: "delegated",
    family_key: target?.family_key
      || `gateway:${candidate.candidate_kind}:${candidate.fingerprint.slice(0, 16)}`,
    ...(targetRequired ? {
      target_memory_id: target.id,
      expected_content_hash: target.content_hash,
      expected_updated_at: target.updated_at,
    } : {}),
    lifecycle_class: lifecycleClass,
    memory_kind: target && classifyLifecycleMemory(target) !== "unclassified"
      ? target.kind
      : candidateMemoryKind(candidate.candidate_kind),
    attributes: {
      layer: candidate.importance >= 85 ? "core" : candidate.importance >= 60 ? "context" : "archive",
      event_date: candidate.event_date,
      tags: candidate.tags,
      triggers: candidate.triggers,
      sensitivity: candidate.sensitivity,
      mentionability: candidate.mentionability,
      importance: candidate.importance,
      load_policy: candidate.candidate_kind === "intimate-agreement"
        ? "manifest-always"
        : (candidate.importance >= 85 ? "deep-rotate" : "contextual"),
      standing_opt_in: candidate.candidate_kind === "intimate-agreement",
      scope: candidate.sensitivity === "intimate" ? "private_relationship" : "private_general",
      activation_policy: candidate.candidate_kind === "intimate-agreement"
        ? "relationship_contextual"
        : "explicit_trigger",
      egress_policy: "local_only",
      safe_projection: candidate.safe_projection || target?.safe_projection || null,
      recall_summary: candidate.recall_summary || null,
      public_projection: candidate.public_projection || null,
    },
    risk: "low",
    title: candidate.title,
    content: candidate.content,
    source_refs: candidate.source_refs.map((source) => ({
      source_type: source.source_type,
      source_id: source.source_id,
      ...(source.excerpt ? { excerpt: source.excerpt } : {}),
      ...(source.occurred_at ? { occurred_at: source.occurred_at } : {}),
      ...(source.written_at ? { written_at: source.written_at } : {}),
      ...(source.source_hash ? { source_hash: source.source_hash } : {}),
      ...(source.material_id ? { material_id: source.material_id } : {}),
      ...(source.source_context ? { source_context: source.source_context } : {}),
      ...(source.metadata && Object.keys(source.metadata).length ? { metadata: source.metadata } : {}),
    })),
  };
}

function candidateLifecycleClass(kind) {
  if (["project-milestone", "shared-moment", "daily-event", "intimate-scene"].includes(kind)) return "episode";
  if (["vow", "identity", "permission", "intimate-agreement"].includes(kind)) return "protected";
  return "belief";
}

function candidateMemoryKind(kind) {
  return {
    "project-milestone": "event",
    "shared-moment": "episode",
    "daily-event": "episode",
    "intimate-scene": "episode",
    vow: "promise",
    identity: "anchor",
    permission: "agreement",
    "intimate-agreement": "intimate-agreement",
    correction: "preference",
  }[kind] || (kind === "preference" ? "preference" : "profile");
}

function normalizeSourceRefs(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((item, index) => ({
    source_type: String(item?.source_type || item?.room || "unknown").trim().slice(0, 80) || "unknown",
    source_id: String(item?.source_id || item?.message_id || `source-${index + 1}`).trim().slice(0, 240) || `source-${index + 1}`,
    excerpt: optionalText(item?.excerpt, 2000),
    occurred_at: optionalText(item?.occurred_at, 80),
    written_at: optionalText(item?.written_at, 80),
    source_hash: optionalText(item?.source_hash, 128),
    material_id: optionalText(item?.material_id, 240),
    source_context: normalizeSourceContext(item?.source_context),
    metadata: item?.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata : {},
  }));
}

function normalizeSourceContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const content = optionalText(value.content, 50_000);
  if (!content) return undefined;
  const optionalFields = {
    speaker: optionalText(value.speaker, 80),
    conversation_id: optionalText(value.conversation_id, 240),
    window_id: optionalText(value.window_id, 240),
    message_id: optionalText(value.message_id, 240),
    occurred_at: optionalText(value.occurred_at, 80),
    written_at: optionalText(value.written_at, 80),
  };
  return {
    content,
    ...Object.fromEntries(Object.entries(optionalFields).filter(([, item]) => item)),
    sensitivity: ["personal", "private", "sensitive", "intimate"].includes(value.sensitivity)
      ? value.sensitivity : "private",
  };
}

function requiredText(value, name, limit) {
  const result = String(value || "").trim();
  if (!result) throw new TypeError(`${name} is required`);
  if (result.length > limit) throw new TypeError(`${name} is too long`);
  return result;
}

function optionalText(value, limit) {
  const result = String(value || "").trim();
  return result ? result.slice(0, limit) : null;
}

function cleanStrings(value, limit, itemLimit) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
    .slice(0, limit).map((item) => item.slice(0, itemLimit));
}

function clampInteger(value, minimum, maximum) {
  const number = Number.parseInt(value, 10);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : minimum));
}
