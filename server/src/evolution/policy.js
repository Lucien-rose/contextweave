import { publicError } from "../lib/error.js";
import { memoryBranchKey } from "../family/groups.js";

export function readDelegationPolicy(db) {
  const row = db.prepare("SELECT * FROM evolution_policy WHERE id = 1").get();
  return { enabled: Boolean(row.enabled), updated_at: row.updated_at, notifications: "important-only" };
}

export function setDelegationPolicy(db, { enabled, confirmation }) {
  if (confirmation !== true || typeof enabled !== "boolean") throw publicError("Explicit policy confirmation required");
  db.prepare("UPDATE evolution_policy SET enabled = ?, updated_at = ? WHERE id = 1")
    .run(Number(enabled), new Date().toISOString());
  return readDelegationPolicy(db);
}

export function reviewReason(db, intent, target, family) {
  const userDirected = intent.authority === "user_correction";
  if (userDirected && !intent.user_instruction) return "user_instruction_required";
  if (!userDirected && !readDelegationPolicy(db).enabled) return "delegation_disabled";
  if (!userDirected && intent.risk === "ambiguous") return "semantic_review_required";
  const needsTarget = ["reinforce", "supersede", "correct", "coexist"].includes(intent.operation);
  if (needsTarget && !target) return "target_required";
  if (target && (target.family_key !== intent.family_key || target.status !== "active")) return "target_not_current";
  if (target && (target.content_hash !== intent.expected_content_hash || target.updated_at !== intent.expected_updated_at)) return "stale_target";
  if (!needsTarget && target) return "unexpected_target";
  if (intent.operation === "create" && family.length) return "family_already_exists";
  if (intent.operation === "append_episode" && intent.lifecycle_class !== "episode") return "episode_class_required";
  if (intent.lifecycle_class === "episode" && intent.operation !== "append_episode") return "immutable_episode";
  if (["supersede", "correct"].includes(intent.operation)) {
    const branch = memoryBranchKey(db, target);
    const active = family.filter((m) => m.status === "active" && memoryBranchKey(db, m) === branch);
    if (active.length !== 1) return "ambiguous_current_state";
  }
  if (intent.operation === "reinforce" && target.content !== intent.content) return "reinforce_content_mismatch";
  return null;
}
