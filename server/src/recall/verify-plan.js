/*
 * VerificationHint and stale-current assessment are adapted from
 * GoodMemory src/verify/policy.ts (MIT, v0.7.5).
 * See THIRD_PARTY_NOTICES.md.
 */
import { sourceAuthorityForMemory } from "./chronicle-evidence.js";
import { normalize } from "./runtime.js";

const CURRENT_REFERENCE = /(?:现在|如今|当前|目前|现时|此刻|今天|仍然|还是|now|current(?:ly)?|latest|today)/i;
const INFORMATION_REQUEST = /(?:吗|么|是不是|是否|有没有|还(?:会|在|是|能|要)?|什么|怎样|如何|多少|几|\?|？|check|verify|confirm)/i;
const EXTERNAL_VOLATILE_SUBJECT = /(?:部署|运行(?:中|版|状态)?|服务状态|在线状态|版本|release|package|commit|分支|schema|数据库状态|迁移状态|许可证|价格|天气|航班|日程)/i;

export const VERIFY_PLAN_SCHEMA = "verify-authority-v1";

export function resolveVerifyPlan(rawQuery, scored = []) {
  const query = normalize(rawQuery);
  const memories = scored.map((entry) => entry.memory || entry);
  const currentReference = CURRENT_REFERENCE.test(query);
  const externalVolatileSubject = EXTERNAL_VOLATILE_SUBJECT.test(query);
  const currentStateRequest = currentReference && (INFORMATION_REQUEST.test(query) || externalVolatileSubject);
  const externalAuthorityRequired = currentReference && externalVolatileSubject;
  const historicalLead = currentStateRequest && memories.some((memory) =>
    sourceAuthorityForMemory(memory).temporal_scope === "historical");
  const required = Boolean(memories.length && (externalAuthorityRequired || historicalLead));
  return Object.freeze({
    schema_version: VERIFY_PLAN_SCHEMA,
    required,
    current_state_request: currentStateRequest,
    authority_required: externalAuthorityRequired,
    external_check_required: required,
    reason: externalAuthorityRequired
      ? "external-authoritative-current-state"
      : historicalLead
      ? "historical-evidence-cannot-prove-current-state"
      : "durable-memory-recall",
  });
}

export function applyVerifyAuthority(scored, traceCandidates, plan) {
  if (!plan.required || !plan.authority_required || scored.length < 2) return scored;
  const highest = Math.max(...scored.map(({ memory }) => sourceAuthorityForMemory(memory).rank));
  if (highest < 2) return scored;
  const selected = scored.filter(({ memory }) => sourceAuthorityForMemory(memory).rank === highest);
  const selectedIds = new Set(selected.map(({ memory }) => memory.id));
  for (const candidate of traceCandidates) {
    if (candidate.admission === "admit" && !selectedIds.has(candidate.id)) {
      candidate.admission = "suppress";
      candidate.reason = "verification-lower-authority";
    }
  }
  return selected;
}

export function verificationResult(plan, memories) {
  if (!plan.required || !memories.length) return null;
  return Object.freeze({
    ...plan,
    evidence_ids: Object.freeze(memories.map((memory) => memory.id)),
    guidance: "Use returned memory only as a lead; verify the current state with an authoritative source before asserting it.",
  });
}

export function recallRoute(memories, plan) {
  if (!memories.length) return "NO_RECALL";
  return plan.required ? "VERIFY" : "RECALL";
}
