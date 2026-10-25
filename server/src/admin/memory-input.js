import { badRequest, clampInteger, cleanOptional, cleanRequired, cleanStringArray } from "./http.js";
import { SEMANTIC_MEMORY_KINDS, semanticMemoryKind } from "../memory-kind.js";

const ALLOWED_SENSITIVITY = new Set(["personal", "private", "sensitive", "intimate"]);
const ALLOWED_MENTIONABILITY = new Set(["natural", "contextual", "explicit-only"]);
const ALLOWED_KINDS = new Set(SEMANTIC_MEMORY_KINDS);
const ALLOWED_LOAD_POLICIES = new Set(["contextual", "deep-rotate", "manifest-always", "explicit-only"]);
const ALLOWED_SCOPES = new Set(["private_general", "private_relationship"]);
const ALLOWED_ACTIVATION_POLICIES = new Set(["explicit_trigger", "relationship_contextual", "scene_only"]);

export function normalizeDraft(input, base) {
  const requestedKind = ALLOWED_KINDS.has(input.kind) ? input.kind : semanticMemoryKind(base?.kind, "memory");
  const title = cleanRequired(input.title ?? base?.title, "Title", 160);
  const content = cleanRequired(input.content ?? base?.content, "Content", 50_000);
  const safeProjection = input.safe_projection === null || input.safe_projection === ""
    ? null
    : cleanOptional(input.safe_projection ?? base?.safe_projection, 5000);
  const eventDate = input.event_date === "" ? null : (input.event_date ?? base?.event_date ?? null);
  if (eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) throw badRequest("Event date must use YYYY-MM-DD");
  const importance = clampInteger(input.importance ?? base?.importance ?? 60, 0, 100);
  const sensitivity = ALLOWED_SENSITIVITY.has(input.sensitivity) ? input.sensitivity : (base?.sensitivity || "private");
  const mentionability = ALLOWED_MENTIONABILITY.has(input.mentionability) ? input.mentionability : (base?.mentionability || "contextual");
  const standingOptIn = input.standing_opt_in === undefined ? Boolean(base?.standing_opt_in) : Boolean(input.standing_opt_in);
  return {
    requested_kind: requestedKind,
    title,
    content,
    safe_projection: safeProjection,
    recall_summary: input.recall_summary === null || input.recall_summary === "" ? null
      : cleanOptional(input.recall_summary ?? base?.recall_summary ?? safeProjection, 5000),
    public_projection: input.public_projection === null || input.public_projection === "" ? null
      : cleanOptional(input.public_projection ?? base?.public_projection, 5000),
    event_date: eventDate,
    tags: cleanStringArray(input.tags ?? base?.tags ?? [], 30, 80),
    triggers: cleanStringArray(input.triggers ?? base?.triggers ?? [], 30, 120),
    ambient_triggers: cleanStringArray(input.ambient_triggers ?? base?.ambient_triggers ?? [], 30, 120),
    sensitivity,
    mentionability,
    importance,
    family_key: cleanOptional(input.family_key ?? base?.family_key, 160),
    version: clampInteger(input.version ?? (base ? (base.version || 1) + 1 : 1), 1, 1_000_000),
    load_policy: ALLOWED_LOAD_POLICIES.has(input.load_policy)
      ? input.load_policy
      : (base?.load_policy || (requestedKind === "intimate-agreement" ? "manifest-always" : "contextual")),
    standing_opt_in: standingOptIn,
    scope: ALLOWED_SCOPES.has(input.scope)
      ? input.scope
      : (base?.scope || (sensitivity === "intimate" ? "private_relationship" : "private_general")),
    activation_policy: ALLOWED_ACTIVATION_POLICIES.has(input.activation_policy)
      ? input.activation_policy
      : (base?.activation_policy || (requestedKind === "intimate-agreement" && standingOptIn
        ? "relationship_contextual"
        : "explicit_trigger")),
    egress_policy: "local_only",
  };
}

export function layerForImportance(importance) {
  return importance >= 85 ? "core" : importance >= 60 ? "context" : "archive";
}

