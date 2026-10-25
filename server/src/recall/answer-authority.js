import { sourceAuthorityForMemory } from "./chronicle-evidence.js";
import { selectRecallRepresentatives } from "./ranking.js";

export const ANSWER_AUTHORITY_SCHEMA = "answer-authority-v1";

export function resolveAnswerAuthority(repository, entries, recallPlan) {
  const families = new Map();
  const authorityById = new Map();

  for (const entry of entries) {
    const memory = entry.memory;
    const familyKey = memory.family_key || memory.id;
    let lifecycle = families.get(familyKey);
    if (!lifecycle) {
      lifecycle = repository.lifecycle(memory);
      families.set(familyKey, lifecycle);
    }
    authorityById.set(memory.id, authorityFor(entry, lifecycle, recallPlan));
  }

  return authorityById;
}

export function applyAnswerAuthority(entries, authorityById) {
  return entries.map((entry) => {
    const authority = authorityById.get(entry.memory.id);
    if (!authority) return entry;
    if (authority.lifecycle_state !== "disputed") {
      return { ...entry, answerAuthority: authority };
    }
    return {
      ...entry,
      answerAuthority: authority,
      recallRole: entry.recallRole === "factual" ? "supporting" : entry.recallRole,
      evidenceType: entry.recallRole === "factual" ? "conflicting_state" : entry.evidenceType,
      recallReason: entry.recallRole === "factual"
        ? "the query directly matches a disputed current state; present it as unresolved evidence"
        : entry.recallReason,
    };
  });
}

export function selectAnswerAuthorityRepresentatives(entries, authorityById) {
  const distinctFamilies = new Set([...authorityById.values()]
    .filter(({ lifecycle_state: state }) => state === "coexisting" || state === "disputed")
    .map(({ family_key: familyKey }) => familyKey));
  return selectRecallRepresentatives(entries, { distinctFamilies });
}

function authorityFor(entry, lifecycle, recallPlan) {
  const memory = entry.memory;
  const state = lifecycleState(memory, lifecycle);
  const source = sourceAuthorityForMemory(memory);
  return Object.freeze({
    schema_version: ANSWER_AUTHORITY_SCHEMA,
    lifecycle_state: state,
    answer_policy: answerPolicy(state, recallPlan),
    specificity: specificity(entry),
    source_authority: source.level,
    source_integrity: source.integrity,
    effective_at: memory.event_date || memory.updated_at || memory.created_at || null,
    family_key: memory.family_key || memory.id,
    reason_codes: Object.freeze(reasonCodes(state, recallPlan)),
  });
}

function lifecycleState(memory, lifecycle) {
  if (memory.status === "superseded") return "historical";
  if (memory.status === "archived") return "archived";
  if (lifecycle?.dimension?.category !== "belief") {
    return memory.status === "active" ? "current" : "unknown";
  }
  const state = lifecycle?.state_history?.find((item) => item.memory_ids.includes(memory.id));
  return state?.validity || (memory.status === "active" ? "current" : "unknown");
}

function answerPolicy(state, recallPlan) {
  if (state === "disputed") return "qualify-conflict";
  if (state === "coexisting") return "answer-together";
  if (state === "historical") {
    return recallPlan?.historical_intent ? "answer-historical" : "context-only";
  }
  if (state === "archived") return "context-only";
  return "answer";
}

function specificity(entry) {
  if (entry.rawDirectEvidence) return "direct";
  if (entry.associationEvidence) return "associative";
  return "supporting";
}

function reasonCodes(state, recallPlan) {
  if (state === "disputed") return ["disputed-current-state", "do-not-assert-settled"];
  if (state === "coexisting") return ["coexisting-current-state", "preserve-joint-answer"];
  if (state === "historical") {
    return recallPlan?.historical_intent
      ? ["historical-state", "explicit-historical-query"]
      : ["historical-state", "not-current-authority"];
  }
  if (state === "archived") return ["archived-state", "not-current-authority"];
  if (state === "current") return ["current-state"];
  return ["lifecycle-state-unknown"];
}
