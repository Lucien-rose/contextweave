import { parseContract } from "../lib/contract.js";
import { projectMemoryCard } from "../memory-card.js";
import { memorySummary } from "../memory-summary.js";
import { relationBundleSchema } from "./contract.js";
import { activeAt, evidenceFingerprint, navigationPolicy, nodeKey, originalNode, projectRelation, visibleNode } from "./materials.js";

// Client-held selections: no saved session, new review or graph write.
export function relationBundle(db, input) {
  const request = navigationPolicy(db, parseContract(relationBundleSchema, input));
  const result = { schema_version: "relation-bundle-v1", namespace: request.namespace,
    as_of: request.as_of, paths: request.paths.map((_, index) => ({ index, status: "unavailable-or-changed" })),
    nodes: [], relations: [], evidence: [] };
  const nodes = new Map();
  const relations = new Map();
  const evidence = new Map();
  for (const [index, selection] of request.paths.entries()) {
    const path = readSelectedPath(db, selection, request);
    if (!path) continue;
    const additions = collectMaterials(db, path, request, nodes, relations, evidence);
    const receipt = { index, status: "ready", nodes: path.nodes, steps: path.steps };
    const nextPaths = result.paths.map((old, i) => i === index ? receipt : old);
    const proposed = { ...result, paths: nextPaths, nodes: [...additions.nodes.values()],
      relations: [...additions.relations.values()], evidence: [...additions.evidence.values()] };
    if (JSON.stringify(proposed).length > request.context_budget_chars) {
      result.paths[index] = { index, status: "output-budget" };
      continue;
    }
    result.paths[index] = receipt;
    for (const [key, value] of additions.nodes) nodes.set(key, value);
    for (const [key, value] of additions.relations) relations.set(key, value);
    for (const [key, value] of additions.evidence) evidence.set(key, value);
  }
  return { ...result, nodes: [...nodes.values()], relations: [...relations.values()], evidence: [...evidence.values()] };
}

function readSelectedPath(db, selection, request) {
  if (!visibleNode(db, selection.seed, request)) return null;
  const nodes = [selection.seed];
  const relations = [];
  for (const step of selection.steps) {
    const row = db.prepare("SELECT * FROM relation_assertions WHERE id = ?").get(step.relation_id);
    const relation = row && projectRelation(db, row, request, { excerpts: true });
    if (!relation || relation.status !== "accepted" || relation.evidence_state !== "valid"
      || relation.updated_at !== step.updated_at || evidenceFingerprint(relation) !== step.evidence_fingerprint
      || !activeAt(relation, request.as_of)) return null;
    const from = step.traversal === "forward" ? relation.from : relation.to;
    const to = step.traversal === "forward" ? relation.to : relation.from;
    if (nodeKey(from) !== nodeKey(nodes.at(-1)) || nodes.some((node) => nodeKey(node) === nodeKey(to))) return null;
    nodes.push({ type: to.type, id: to.id });
    relations.push(relation);
  }
  return { nodes, relations, steps: selection.steps.map(({ relation_id, traversal }) => ({ relation_id, traversal })) };
}

function collectMaterials(db, path, request, oldNodes, oldRelations, oldEvidence) {
  const nodes = new Map(oldNodes);
  const relations = new Map(oldRelations);
  const evidence = new Map(oldEvidence);
  for (const node of path.nodes) {
    const key = nodeKey(node);
    if (nodes.has(key)) continue;
    const header = visibleNode(db, node, request);
    if (node.type !== "memory") { nodes.set(key, header); continue; }
    const memory = originalNode(db, node, request.namespace);
    const summary = memorySummary(memory);
    nodes.set(key, { type: "memory", ...projectMemoryCard(memory, { excerpt: summary || memory.content.slice(0, 240),
      detailLevel: summary ? "summary" : "cue" }), occurred_at: header.occurred_at, written_at: header.written_at });
  }
  for (const relation of path.relations) {
    if (relations.has(relation.id)) continue;
    const evidenceIds = [];
    for (const ref of relation.evidence) {
      const key = `${nodeKey(ref)}:${ref.content_hash}:${ref.start}:${ref.end}`;
      evidenceIds.push(key);
      if (!evidence.has(key)) evidence.set(key, { evidence_id: key, ...ref });
    }
    const { evidence: ignored, from, to, usage, answer_authority_granted, ...card } = relation;
    relations.set(relation.id, { ...card, from: { type: from.type, id: from.id },
      to: { type: to.type, id: to.id }, evidence_ids: evidenceIds });
  }
  return { nodes, relations, evidence };
}
