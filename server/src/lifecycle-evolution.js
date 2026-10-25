import { observeMemoryLifecycle } from "./lifecycle-observer.js";
import {
  commitLifecycleTransition,
  readLifecycleEvolutionReceipt,
} from "./memory-commit.js";

const REQUIRED_REASONS = new Set(["explicit_supersedes_link", "distinct_state_value"]);

export function planLifecycleEvolution(db, input) {
  const resolved = resolvePlan(db, input);
  return resolved?.public_result || null;
}

export function applyLifecycleEvolution(db, { memoryId, proposalId, confirmation }) {
  const replay = readLifecycleEvolutionReceipt(db, proposalId);
  if (replay) return evolutionResult("already_applied", replay);
  if (confirmation !== true) return rejected("confirmation_required");

  const resolved = resolvePlan(db, { memoryId, proposalId });
  if (!resolved) return null;
  if (resolved.public_result.status !== "ready") return resolved.public_result;

  try {
    const outcome = commitLifecycleTransition(db, resolved.commit_plan);
    return evolutionResult(outcome.status, outcome);
  } catch (error) {
    return rejected("proposal_became_stale", [error.message]);
  }
}

function resolvePlan(db, { memoryId, proposalId }) {
  const observation = observeMemoryLifecycle(db, { memoryId });
  if (!observation) return null;
  if (observation.blockers.length) {
    return { public_result: rejected("family_blocked", observation.blockers) };
  }

  const proposal = observation.proposals.find((item) => item.proposal_id === proposalId);
  if (!proposal) return { public_result: rejected("proposal_not_current") };
  if (!isExplicitCorrection(proposal)) {
    return { public_result: rejected("proposal_type_not_supported", proposal.reason_codes) };
  }

  const candidateId = proposal.candidate_memory_ids[0];
  const targetId = proposal.target_memory_ids[0];
  const records = loadTransitionRecords(db, candidateId, targetId);
  if (!records || !transitionMatches(observation.family_key, records)) {
    return { public_result: rejected("proposal_became_stale") };
  }

  const plan = {
    schema_version: 1,
    evolution_mode: "controlled",
    status: "ready",
    proposal_id: proposal.proposal_id,
    family_key: observation.family_key,
    lifecycle_class: observation.lifecycle_class,
    transition: {
      candidate_memory_id: candidateId,
      target_memory_id: targetId,
      candidate_status: ["draft", "active"],
      target_status: ["active", "superseded"],
    },
    confirmation_required: true,
    mutation: {
      canonical_memories_changed: true,
      automatic_merge: false,
      automatic_supersede: false,
      automatic_delete: false,
    },
  };
  return {
    public_result: plan,
    commit_plan: {
      proposal_id: proposal.proposal_id,
      family_key: observation.family_key,
      candidate_memory_id: candidateId,
      target_memory_id: targetId,
      candidate_content_hash: records.candidate.content_hash,
      target_content_hash: records.target.content_hash,
    },
  };
}

function isExplicitCorrection(proposal) {
  return proposal.type === "new_state_candidate"
    && proposal.review_required === true
    && proposal.candidate_memory_ids.length === 1
    && proposal.target_memory_ids.length === 1
    && [...REQUIRED_REASONS].every((reason) => proposal.reason_codes.includes(reason));
}

function loadTransitionRecords(db, candidateId, targetId) {
  const rows = db.prepare(`
    SELECT id, family_key, status, supersedes_id, content_hash
    FROM memories
    WHERE id IN (?, ?)
  `).all(candidateId, targetId);
  if (rows.length !== 2) return null;
  return {
    candidate: rows.find((row) => row.id === candidateId),
    target: rows.find((row) => row.id === targetId),
  };
}

function transitionMatches(familyKey, { candidate, target }) {
  return candidate?.status === "draft"
    && target?.status === "active"
    && candidate.supersedes_id === target.id
    && (candidate.family_key || `memory:${candidate.id}`) === familyKey
    && (target.family_key || `memory:${target.id}`) === familyKey;
}

function rejected(reason, blockers = []) {
  return {
    schema_version: 1,
    evolution_mode: "controlled",
    status: "rejected",
    reason,
    blockers,
    mutation: {
      canonical_memories_changed: false,
      automatic_merge: false,
      automatic_supersede: false,
      automatic_delete: false,
    },
  };
}

function evolutionResult(status, receipt) {
  return {
    schema_version: 1,
    evolution_mode: "controlled",
    status,
    proposal_id: receipt.proposal_id,
    family_key: receipt.family_key,
    result: {
      active_memory_id: receipt.active_memory_id,
      superseded_memory_id: receipt.superseded_memory_id,
    },
    mutation: {
      canonical_memories_changed: status === "applied",
      automatic_merge: false,
      automatic_supersede: false,
      automatic_delete: false,
    },
  };
}
