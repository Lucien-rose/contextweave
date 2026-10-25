import { parseContract } from "../lib/contract.js";
import { relationPathsSchema } from "./contract.js";
import { adjacentRows } from "./service.js";
import { activeAt, evidenceFingerprint, navigationPolicy, nodeKey, projectRelation, visibleNode } from "./materials.js";

// Discovery is bounded by work, not by the size of the eventual response.
const MAX_INSPECTED = 512;

export function relationPaths(db, input) {
  const request = navigationPolicy(db, parseContract(relationPathsSchema, input));
  const seed = visibleNode(db, request.seed, request);
  const result = { schema_version: "relation-paths-v2", paths: [], nodes: [],
    coverage: "bounded-search", absence_means_nonexistence: false,
    search_limited: false, output_limited: false, answer_authority_granted: false,
    namespace: request.namespace, as_of: request.as_of,
    limits: { max_hops: request.max_hops, max_inspected: MAX_INSPECTED,
      max_nodes: request.max_nodes, max_paths: request.max_paths, context_budget_chars: request.context_budget_chars } };
  if (!seed || (request.target && !visibleNode(db, request.target, request))) return result;
  const found = discover(db, seed, request);
  const candidates = request.target
    ? found.paths.filter((path) => nodeKey(path.nodes.at(-1)) === nodeKey(request.target)) : found.paths;
  const selected = packDirectory(candidates, request);
  return { ...result, ...selected, search_limited: found.limited };
}

function discover(db, seed, request) {
  const queue = [{ seed: ref(seed), nodes: [seed], steps: [] }];
  const paths = [];
  const cache = new Map();
  let inspected = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const path = queue[index];
    if (path.steps.length >= request.max_hops) continue;
    const tail = path.nodes.at(-1);
    for (const row of adjacentRows(db, tail, request.namespace)) {
      if (++inspected > MAX_INSPECTED) return { paths, limited: true };
      if (row.status !== "accepted" || !request.types.includes(row.type)) continue;
      const forward = row.from_type === tail.type && row.from_id === tail.id;
      if ((request.direction === "outgoing" && !forward) || (request.direction === "incoming" && forward)) continue;
      if (!cache.has(row.id)) cache.set(row.id, projectRelation(db, row, request));
      const relation = cache.get(row.id);
      if (!relation || relation.evidence_state !== "valid" || !activeAt(relation, request.as_of)) continue;
      const next = forward ? relation.to : relation.from;
      if (path.nodes.some((node) => nodeKey(node) === nodeKey(next))) continue;
      const extended = { seed: path.seed, nodes: [...path.nodes, next], steps: [...path.steps, stepCard(relation, forward, request)] };
      paths.push(extended);
      queue.push(extended);
    }
  }
  return { paths, limited: false };
}

function packDirectory(candidates, request) {
  const paths = [];
  const nodes = new Map();
  // Interleave shallow and deep paths; creation order is a stable tie-break,
  // not a relevance judgment. First-hop output cannot starve discovery.
  const groups = [candidates.filter((p) => p.steps.length === 1), candidates.filter((p) => p.steps.length === 2)];
  const ordered = [];
  for (let i = 0; i < Math.max(...groups.map((group) => group.length)); i += 1) {
    for (const group of groups) if (group[i]) ordered.push(group[i]);
  }
  for (const path of ordered) {
    const nextNodes = new Map(nodes);
    path.nodes.forEach((node) => nextNodes.set(nodeKey(node), node));
    const compact = { ...path, nodes: path.nodes.map(ref) };
    const nextPaths = [...paths, compact];
    if (nextPaths.length > request.max_paths || nextNodes.size > request.max_nodes
      || JSON.stringify({ paths: nextPaths, nodes: [...nextNodes.values()] }).length > request.context_budget_chars) continue;
    paths.push(compact);
    for (const [key, node] of nextNodes) nodes.set(key, node);
  }
  return { paths, nodes: [...nodes.values()], output_limited: paths.length < candidates.length };
}

function stepCard(relation, forward, request) {
  return { relation_id: relation.id, type: relation.type, traversal: forward ? "forward" : "reverse",
    from: ref(relation.from), to: ref(relation.to), status: relation.status,
    updated_at: relation.updated_at, evidence_fingerprint: evidenceFingerprint(relation),
    valid_from: relation.valid_from, valid_until: relation.valid_until, temporal_status: relation.temporal_status,
    read_via: { tool: "moss_relation_read", arguments: { relation_id: relation.id, namespace: relation.namespace,
      context: request.context, intimacy_mode: request.intimacy_mode } } };
}

function ref({ type, id }) { return { type, id }; }
