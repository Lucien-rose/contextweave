import { createHash } from "node:crypto";

export const REPAIRABLE_MEMORY_KINDS = new Set([
  "memory", "shared-memory", "context-memory", "intimate-agreement", "quote", "handoff",
  "profile", "anchor", "procedural", "decision",
]);
export const REPAIRABLE_SENSITIVITIES = new Set(["personal", "private", "sensitive", "intimate"]);
export const REPAIRABLE_SCOPES = new Set(["private_general", "private_relationship"]);
export const REPAIRABLE_ACTIVATION_POLICIES = new Set(["explicit_trigger", "relationship_contextual", "scene_only"]);
export const REPAIRABLE_LOAD_POLICIES = new Set(["contextual", "deep-rotate", "manifest-always", "explicit-only"]);

export function declaredPolicyDefaults(row) {
  const intimate = row.sensitivity === "intimate";
  const standingAgreement = intimate && row.kind === "intimate-agreement" && Boolean(row.standing_opt_in);
  return {
    scope: intimate ? "private_relationship" : "private_general",
    activation_policy: standingAgreement ? "relationship_contextual" : "explicit_trigger",
    egress_policy: "local_only",
  };
}

export function contentHash(content) {
  return createHash("sha256").update(String(content || ""), "utf8").digest("hex");
}

