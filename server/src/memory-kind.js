export const SEMANTIC_MEMORY_KINDS = Object.freeze([
  "memory",
  "shared-memory",
  "context-memory",
  "quote",
  "handoff",
  "ambient",
  "preference",
  "profile",
  "style",
  "episode",
  "event",
  "agreement",
  "anchor",
  "intimate-agreement",
  "promise",
]);

const LEGACY_DRAFT_KINDS = Object.freeze({
  "draft-memory": "shared-memory",
  "draft-quote": "quote",
  "draft-handoff": "handoff",
  "draft-intimate-agreement": "intimate-agreement",
});

export function semanticMemoryKind(kind, fallback = "shared-memory") {
  return LEGACY_DRAFT_KINDS[kind]
    || (SEMANTIC_MEMORY_KINDS.includes(kind) ? kind : fallback);
}
