import { clampScore } from "./lib/number.js";
export const CANDIDATE_KINDS = Object.freeze([
  "preference",
  "project-milestone",
  "shared-moment",
  "daily-event",
  "emotional-change",
  "health",
  "trauma",
  "intimate-scene",
  "vow",
  "identity",
  "permission",
  "intimate-agreement",
  "correction",
  "deletion",
  "noise",
]);

const CONFIRMATION_KINDS = new Set([
  "deletion",
]);

const AUTO_SAVE_KINDS = new Set([
  "preference",
  "project-milestone",
  "shared-moment",
  "daily-event",
  "emotional-change",
  "health",
  "trauma",
  "intimate-scene",
  "vow",
  "identity",
  "permission",
  "intimate-agreement",
  "correction",
]);

const DEFAULTS = Object.freeze({
  health: { sensitivity: "sensitive", mentionability: "contextual" },
  trauma: { sensitivity: "sensitive", mentionability: "contextual" },
  "intimate-scene": { sensitivity: "intimate", mentionability: "contextual" },
  "intimate-agreement": { sensitivity: "intimate", mentionability: "explicit-only" },
  permission: { sensitivity: "private", mentionability: "explicit-only" },
});

export function candidateDefaults(kind) {
  return DEFAULTS[kind] || { sensitivity: "private", mentionability: "contextual" };
}

export function evaluateMemoryCandidate(input) {
  const kind = String(input.candidate_kind || "").trim();
  const confidence = clampScore(input.confidence);
  const meaningScore = clampScore(input.meaning_score);
  const sourceRefs = Array.isArray(input.source_refs) ? input.source_refs : [];
  const reasons = [];

  if (!CANDIDATE_KINDS.includes(kind)) {
    return { decision: "review", requires_confirmation: false, reasons: ["unknown-candidate-kind"] };
  }
  if (kind === "noise") {
    return { decision: "ignore", requires_confirmation: false, reasons: ["conversation-debris"] };
  }
  if (CONFIRMATION_KINDS.has(kind)) {
    return { decision: "confirm", requires_confirmation: true, reasons: ["explicit-confirmation-required"] };
  }
  if (!AUTO_SAVE_KINDS.has(kind)) {
    return { decision: "review", requires_confirmation: false, reasons: ["no-policy-route"] };
  }
  if (!sourceRefs.length) reasons.push("missing-source-reference");
  if (confidence < 0.85) reasons.push("confidence-below-0.85");
  if (meaningScore < 0.6) reasons.push("meaning-score-below-0.60");
  if (reasons.length) return { decision: "review", requires_confirmation: false, reasons };
  return { decision: "auto-save", requires_confirmation: false, reasons: ["qualified-ordinary-memory"] };
}
