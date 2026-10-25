import { createHash } from "node:crypto";
import { readLifecycleState } from "./memory-lifecycle.js";

export function observeMemoryLifecycle(db, { memoryId }) {
  const selected = db.prepare(`
    SELECT id, family_key
    FROM memories
    WHERE id = ?
      AND status IN ('active', 'archived', 'superseded', 'draft')
  `).get(memoryId);
  if (!selected) return null;

  const familyKey = selected.family_key || `memory:${selected.id}`;
  const records = db.prepare(`
    SELECT id, family_key, kind, status, supersedes_id, content_hash,
           event_date, created_at, updated_at
    FROM memories
    WHERE COALESCE(family_key, 'memory:' || id) = ?
      AND status IN ('active', 'archived', 'superseded', 'draft')
    ORDER BY COALESCE(event_date, created_at), version, id
  `).all(familyKey);
  const lifecycle = readLifecycleState(db, { memoryId });
  const category = lifecycle.dimension.category;
  const blockers = categoryBlockers(category);
  const proposals = blockers.length ? [] : buildProposals(familyKey, lifecycle, records);

  return {
    schema_version: 1,
    observation_mode: "read-only",
    family_key: familyKey,
    selected_memory_id: memoryId,
    lifecycle_class: category,
    current_state: stateReference(lifecycle.current_state),
    pending_draft_ids: records
      .filter((record) => record.status === "draft")
      .map((record) => record.id),
    proposals,
    blockers,
    trace: {
      canonical_state_count: lifecycle.state_history.length,
      active_state_count: lifecycle.conflict.active_state_count,
      pending_draft_count: records.filter((record) => record.status === "draft").length,
      rules_evaluated: [
        "protected-and-episode-immunity",
        "repeated-evidence",
        "duplicate-canonical-value",
        "explicit-supersedes-transition",
        "unresolved-active-conflict",
        "distinct-draft-without-supersedes",
      ],
    },
    mutation: {
      canonical_memories_changed: false,
      automatic_merge: false,
      automatic_supersede: false,
      automatic_delete: false,
    },
  };
}

function buildProposals(familyKey, lifecycle, records) {
  const proposals = [];
  const canonicalById = new Map(records
    .filter((record) => record.status !== "draft")
    .map((record) => [record.id, record]));

  if (lifecycle.conflict.status === "disputed") {
    proposals.push(proposal(familyKey, "conflict_detected", {
      candidate_memory_ids: lifecycle.state_history
        .filter((state) => state.validity === "disputed")
        .flatMap((state) => state.active_memory_ids),
      reason_codes: ["multiple_active_states"],
      review_required: true,
    }));
  }

  for (const state of lifecycle.state_history) {
    if (state.memory_ids.length > 1) {
      proposals.push(proposal(familyKey, "possible_consolidation", {
        candidate_memory_ids: state.memory_ids,
        reason_codes: ["duplicate_canonical_value"],
        review_required: true,
      }));
    } else if (state.validity === "current" && state.support_count > 1) {
      proposals.push(proposal(familyKey, "reinforce_existing_belief", {
        target_memory_ids: state.memory_ids,
        evidence_count: state.support_count,
        reason_codes: ["repeated_evidence"],
        review_required: false,
      }));
    }
  }

  for (const draft of records.filter((record) => record.status === "draft")) {
    const target = draft.supersedes_id ? canonicalById.get(draft.supersedes_id) : null;
    const current = lifecycle.current_state;
    if (target?.status === "active") {
      proposals.push(proposal(familyKey,
        target.content_hash === draft.content_hash
          ? "reinforce_existing_belief"
          : "new_state_candidate", {
          candidate_memory_ids: [draft.id],
          target_memory_ids: [target.id],
          reason_codes: target.content_hash === draft.content_hash
            ? ["explicit_supersedes_link", "same_state_value"]
            : ["explicit_supersedes_link", "distinct_state_value", "historical_transition_candidate"],
          review_required: true,
        }));
      continue;
    }
    if (!current) {
      proposals.push(proposal(familyKey, "new_state_candidate", {
        candidate_memory_ids: [draft.id],
        reason_codes: ["no_current_state"],
        review_required: true,
      }));
      continue;
    }
    proposals.push(proposal(familyKey,
      current.value_key === draft.content_hash
        ? "reinforce_existing_belief"
        : "conflict_detected", {
        candidate_memory_ids: [draft.id],
        target_memory_ids: current.memory_ids,
        reason_codes: current.value_key === draft.content_hash
          ? ["same_state_value"]
          : ["distinct_state_without_supersedes"],
        review_required: true,
      }));
  }

  return uniqueProposals(proposals);
}

function proposal(familyKey, type, fields) {
  const payload = {
    family_key: familyKey,
    type,
    candidate_memory_ids: [...new Set(fields.candidate_memory_ids || [])].sort(),
    target_memory_ids: [...new Set(fields.target_memory_ids || [])].sort(),
    evidence_count: fields.evidence_count || null,
    reason_codes: fields.reason_codes,
    review_required: fields.review_required,
  };
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 20);
  return { proposal_id: `lifecycle:${digest}`, ...payload };
}

function uniqueProposals(proposals) {
  return [...new Map(proposals.map((item) => [item.proposal_id, item])).values()];
}

function categoryBlockers(category) {
  if (category === "protected") return ["protected_family"];
  if (category === "episode") return ["immutable_episode_family"];
  if (category === "unclassified") return ["lifecycle_class_not_declared"];
  return [];
}

function stateReference(state) {
  if (!state) return null;
  return {
    validity: state.validity,
    memory_ids: state.memory_ids,
    first_seen: state.first_seen,
    last_confirmed: state.last_confirmed,
    support_count: state.support_count,
  };
}
