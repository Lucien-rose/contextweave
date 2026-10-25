import { audit, getMemory, writeMemory } from "./database.js";
import { transaction } from "./lib/transaction.js";
import { semanticMemoryKind } from "./memory-kind.js";
import { inheritFamilyBranch } from "./family/groups.js";
import { classifyLifecycleMemory } from "./lifecycle-classification.js";
import { recordFamilyChange } from "./family/history.js";

const EVOLUTION_ACTION_PREFIX = "lifecycle-evolution:";

export function commitDraftMemory(db, draftId) {
  return transaction(db, () => {
    const draft = getMemory(db, draftId);
    if (!draft || draft.status !== "draft") {
      return null;
    }
    return activateDraft(db, draft);
  });
}

export function commitLifecycleTransition(db, plan) {
  return transaction(db, () => {
    const replay = readLifecycleEvolutionReceipt(db, plan.proposal_id);
    if (replay) {
      return { status: "already_applied", ...replay };
    }

    const draft = getMemory(db, plan.candidate_memory_id);
    const target = getMemory(db, plan.target_memory_id);
    assertTransitionStillCurrent(draft, target, plan);

    const active = activateDraft(db, draft);
    const receipt = {
      proposal_id: plan.proposal_id,
      family_key: plan.family_key,
      active_memory_id: active.id,
      superseded_memory_id: target.id,
    };
    audit(db, active.id, evolutionAction(plan.proposal_id), receipt);
    return { status: "applied", ...receipt };
  });
}

export function readLifecycleEvolutionReceipt(db, proposalId) {
  const row = db.prepare(`
    SELECT snapshot_json
    FROM audit_log
    WHERE action = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(evolutionAction(proposalId));
  if (!row?.snapshot_json) return null;
  try {
    return JSON.parse(row.snapshot_json);
  } catch {
    return null;
  }
}

function activateDraft(db, draft) {
  const before = draft.supersedes_id ? getMemory(db, draft.supersedes_id) : null;
  audit(db, draft.id, "pre-commit", draft);
  if (draft.supersedes_id) {
    const previous = getMemory(db, draft.supersedes_id);
    if (previous?.status === "active") {
      audit(db, previous.id, "pre-supersede", previous);
      const superseded = writeMemory(db, {
        ...previous,
        status: "superseded",
        updated_at: new Date().toISOString(),
      });
      audit(db, superseded.id, "supersede", superseded);
    }
  }
  const active = writeMemory(db, {
    ...draft,
    kind: semanticMemoryKind(draft.kind),
    status: "active",
    updated_at: new Date().toISOString(),
  });
  inheritFamilyBranch(db, active, draft.supersedes_id ? getMemory(db, draft.supersedes_id) : null, {
    distinct: !draft.supersedes_id && classifyLifecycleMemory(active) === "episode",
  });
  audit(db, active.id, "commit", active);
  recordFamilyChange(db, { changeId: `commit:${active.id}`, familyKey: active.family_key,
    operation: before ? "supersede" : classifyLifecycleMemory(active) === "episode" ? "append_episode" : "create",
    before: before ? [before] : [], after: [active], sources: active.evidence });
  return active;
}

function assertTransitionStillCurrent(draft, target, plan) {
  if (!draft || draft.status !== "draft") throw new TypeError("Lifecycle proposal is stale: candidate is not a draft");
  if (!target || target.status !== "active") throw new TypeError("Lifecycle proposal is stale: target is not active");
  if (draft.supersedes_id !== target.id) throw new TypeError("Lifecycle proposal is stale: supersedes link changed");
  const draftFamily = draft.family_key || `memory:${draft.id}`;
  const targetFamily = target.family_key || `memory:${target.id}`;
  if (draftFamily !== plan.family_key || targetFamily !== plan.family_key) {
    throw new TypeError("Lifecycle proposal is stale: family changed");
  }
  if (draft.content_hash !== plan.candidate_content_hash
      || target.content_hash !== plan.target_content_hash) {
    throw new TypeError("Lifecycle proposal is stale: content changed");
  }
}

function evolutionAction(proposalId) {
  return `${EVOLUTION_ACTION_PREFIX}${proposalId}`;
}

