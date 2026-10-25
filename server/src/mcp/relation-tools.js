import { result } from "./shared.js";
import { relationBundleSchema, relationListSchema, relationPathsSchema, relationProposeSchema, relationReadSchema, relationReviewSchema } from "../relation/contract.js";
import { listRelations, proposeRelation, readRelation, reviewRelation } from "../relation/service.js";
import { relationPaths } from "../relation/paths.js";
import { relationBundle } from "../relation/bundle.js";

export function registerRelationTools(server, { db }) {
  for (const [name, schema, action, readOnly, description] of [
    ["moss_relation_propose", relationProposeSchema, proposeRelation, false,
      "Propose an explicitly understood relation after inspecting its exact endpoints and original evidence. Supply verbatim excerpts and current hashes. Scope real people and fictional works/branches separately. This creates a pending assertion, never a canonical fact or recall boost. Similarity, co-occurrence and chronology alone do not prove influence or causality."],
    ["moss_relation_review", relationReviewSchema, reviewRelation, false,
      "After inspecting the proposed relation and its original evidence, record the host's reasoned acceptance, dispute or withdrawal using its exact updated_at. Acceptance means the host checked the stated relation, not user confirmation or factual answer authority. Withdrawn assertions cannot be revived; propose a corrected assertion. Never infer user approval."],
    ["moss_relation_read", relationReadSchema, readRelation, true,
      "Inspect one context-visible relation, pinned evidence excerpts and review history. Changed evidence is marked stale and never silently follows a newer family version. Hidden or removed endpoints/evidence make the assertion unavailable."],
    ["moss_relation_list", relationListSchema, listRelations, true,
      "List bounded, context-visible assertions adjacent to one exact inspected memory/source/entity, including pending or disputed relations. Headers only; no automatic graph expansion or recall authority. Namespace defaults to real."],
    ["moss_relation_paths", relationPathsSchema, relationPaths, true,
      "Explore up to two hops from an exact memory/source/entity, optionally to an exact target. Returns a compact path directory with search/output coverage and client-held step snapshots. The host chooses relevance; query does not add a keyword gate. Use as_of only for a time slice; otherwise each step keeps its own dates. Pass selected paths to moss_relation_bundle for summaries and exact evidence."],
    ["moss_relation_bundle", relationBundleSchema, relationBundle, true,
      "Read selected paths from moss_relation_paths in one call. Returns deduplicated MemoryCards, directed relations and exact evidence excerpts with dates and read entries. Rechecks each selected path independently; a changed or unavailable path does not discard the others. Accepts the returned path objects directly. No approval, saved selection or graph mutation."],
  ]) {
    server.registerTool(name, { description, inputSchema: schema.shape,
      annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: false } },
    async (input) => result(action(db, input)));
  }
}
