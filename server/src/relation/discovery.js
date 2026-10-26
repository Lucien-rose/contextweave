import { z } from "zod/v4";
import { parseContract } from "../lib/contract.js";
import { publicError } from "../lib/error.js";
import { getMemory } from "../database.js";
import { relationReadSchema } from "./contract.js";
import { navigationPolicy, visibleNode } from "./materials.js";
import { relevantChunk } from "../recall/chunks.js";

export const relationDiscoverySchema = relationReadSchema.omit({ relation_id: true }).extend({
  memory_id: z.string().min(1).max(240), limit: z.number().int().min(1).max(20).default(8),
  offset: z.number().int().min(0).default(0),
}).strict();

export function discoverRelations(db, input) {
  const request = navigationPolicy(db, parseContract(relationDiscoverySchema, input));
  const seed = visibleNode(db, { type: "memory", id: request.memory_id }, request);
  if (!seed) throw publicError("Relation material unavailable", 404);
  const original = getMemory(db, seed.id);
  const seedEntities = new Set(entitiesFor(db, seed.id, request));
  const rows = db.prepare(`SELECT id FROM memories WHERE status = 'active' AND id != ?
    ORDER BY updated_at DESC, id LIMIT 201 OFFSET ?`).all(seed.id, request.offset);
  const candidates = [];
  for (const { id } of rows.slice(0, 200)) {
    const visible = visibleNode(db, { type: "memory", id }, request);
    if (!visible) continue;
    const memory = getMemory(db, id);
    const entities = entitiesFor(db, id, request).filter(entity => seedEntities.has(entity));
    const tags = memory.tags.filter(tag => original.tags.includes(tag));
    const sameFamily = original.family_key && original.family_key === memory.family_key;
    if (!sameFamily && !entities.length && tags.length < 2) continue;
    candidates.push({ node: visible, hints: { same_lineage: Boolean(sameFamily), entity_ids: entities, shared_tags: tags },
      evidence: excerpt(memory, request.query || original.title),
      score: Number(sameFamily) * 4 + entities.length * 3 + Math.min(tags.length, 3) });
  }
  candidates.sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
  return { seed, seed_evidence: excerpt(original, request.query), candidates: candidates.slice(0, request.limit),
    coverage: { scanned: Math.min(rows.length, 200), matched: candidates.length,
      truncated: candidates.length > request.limit, next_offset: rows.length > 200 ? request.offset + 200 : null },
    usage: "discovery-hints-only", relations_written: 0,
    guidance: "Shared entities, tags and Lineage are leads, not proof of a relation. Inspect originals, then propose and review an exact assertion." };
}

function entitiesFor(db, id, request) {
  return db.prepare(`SELECT e.id FROM memory_entities m JOIN entities e ON e.id = m.entity_id
    WHERE m.memory_id = ? AND e.namespace = ? ORDER BY e.id`).all(id, request.namespace)
    .filter(row => visibleNode(db, { type: "entity", id: row.id }, request)).map(row => row.id);
}

function excerpt(memory, query) {
  const window = relevantChunk(memory.content, query, { topics: [], stateCues: [], hypotheses: [] }, 500);
  return { type: "memory", id: memory.id, content_hash: memory.content_hash,
    start: window.chunk?.start || 0, excerpt: window.content };
}
