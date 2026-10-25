import { getMemory } from "../database.js";
import { listArcMaterials, readArc } from "../arc/service.js";
import { cardArcMemberships, membershipsFor } from "../memory-navigation.js";
import { navigationPolicy, projectRelation } from "../relation/materials.js";
import { STARFIELDS } from "../starfield/catalog.js";
import { starfieldFor } from "../starfield/service.js";

const OWNER = { context: "intimate", intimacy_mode: "on" };

export function arcsForMemory(db, memoryId) {
  const memory = getMemory(db, memoryId);
  if (!memory) return null;
  const index = cardArcMemberships(db, [memory], { context: OWNER.context, intimacyMode: OWNER.intimacy_mode });
  return { memory_id: memoryId, arcs: membershipsFor(memory, index) };
}

export function readArcAtlas(db, arcId) {
  const arc = readArc(db, { arc_id: arcId, ...OWNER }).arc;
  const materials = allMaterials(db, arcId);
  const nodes = materials.map((material, order) => atlasNode(db, material, order));
  const keys = new Set(nodes.map(({ key }) => key));
  return {
    projection_mode: "read-only",
    usage: "navigation-only",
    arc,
    nodes,
    edges: [...sequenceEdges(nodes), ...relationEdges(db, keys), ...lifecycleEdges(db, keys)],
  };
}

export function readGlobalAtlas(db) {
  const rows = db.prepare(`SELECT m.id, m.title, m.kind, m.status, m.event_date, m.created_at,
      COALESCE(s.starfield, 'unnamed') AS starfield FROM memories m
    LEFT JOIN memory_starfields s ON s.memory_id = m.id
    WHERE m.status = 'active' ORDER BY m.created_at, m.id`).all();
  const nodes = new Map(rows.map((row) => [`memory:${row.id}`, {
    key: `memory:${row.id}`, type: "memory", id: row.id, memory_id: row.id,
    title: row.title, kind: row.kind, status: row.status, starfield: row.starfield,
    occurred_at: row.event_date || row.created_at, arcs: [],
  }]));
  const aliases = new Map();
  const arcs = [];
  const edges = [];
  for (const arc of db.prepare("SELECT * FROM arcs WHERE status = 'active' ORDER BY created_at, id").all()) {
    const members = [];
    for (const [order, material] of allMaterials(db, arc.id).entries()) {
      const node = atlasNode(db, material, order);
      const key = node.memory_id ? `memory:${node.memory_id}` : node.key;
      aliases.set(node.key, key);
      if (!nodes.has(key)) nodes.set(key, { ...node, key, type: node.memory_id ? "memory" : node.type,
        starfield: node.memory_id ? starfieldFor(db, node.memory_id) : "unnamed", arcs: [] });
      if (!members.includes(key)) members.push(key);
      const star = nodes.get(key);
      if (!star.arcs.includes(arc.id)) star.arcs.push(arc.id);
    }
    arcs.push({ id: arc.id, title: arc.title, members });
    edges.push(...sequenceEdges(members.map((key) => ({ key })))
      .map((edge) => ({ ...edge, id: `${arc.id}:${edge.id}`, arc_id: arc.id })));
  }
  const keys = new Set([...nodes.keys(), ...aliases.keys()]);
  for (const edge of [...relationEdges(db, keys), ...lifecycleEdges(db, keys)]) {
    const from = aliases.get(edge.from) || edge.from;
    const to = aliases.get(edge.to) || edge.to;
    if (from !== to) edges.push({ ...edge, from, to });
  }
  return { projection_mode: "read-only", usage: "navigation-only", nodes: [...nodes.values()], arcs, edges,
    starfields: STARFIELDS.map((field) => ({ ...field,
      count: [...nodes.values()].filter((node) => node.starfield === field.id).length })) };
}

function allMaterials(db, arcId) {
  const materials = [];
  let offset = 0;
  do {
    const page = listArcMaterials(db, { arc_id: arcId, ...OWNER, limit: 50, offset });
    materials.push(...page.materials);
    offset = page.next_offset;
  } while (offset !== null);
  return materials;
}

function atlasNode(db, material, order) {
  const key = `${material.material_type}:${material.material_id}`;
  const family = material.material_type === "family" ? familyDisplay(db, material.material_id) : null;
  const node = {
    key,
    type: material.material_type,
    id: material.material_id,
    title: family?.title || material.title,
    kind: material.kind,
    status: material.status,
    chapter: material.chapter,
    position: material.position,
    order,
    occurred_at: material.occurred_at || null,
  };
  if (material.material_type === "memory") node.memory_id = material.material_id;
  if (family) { node.family_key = material.material_id; node.memory_id = family.id; }
  return node;
}

function familyDisplay(db, familyKey) {
  return db.prepare(`SELECT id, title FROM memories WHERE family_key = ?
    ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, updated_at DESC, id LIMIT 1`)
    .get(familyKey) || null;
}

function sequenceEdges(nodes) {
  const edges = [];
  for (let index = 1; index < nodes.length; index += 1) {
    edges.push({ id: `arc:${index - 1}:${index}`, from: nodes[index - 1].key,
      to: nodes[index].key, kind: "arc", directed: false });
  }
  return edges;
}

function relationEdges(db, keys) {
  const policy = navigationPolicy(db, { ...OWNER, namespace: "real", query: "" });
  const edges = [];
  for (const row of db.prepare("SELECT * FROM relation_assertions WHERE status = 'accepted' ORDER BY created_at, id").iterate()) {
    const relation = projectRelation(db, row, policy);
    if (!relation) continue;
    const from = `${relation.from.type}:${relation.from.id}`;
    const to = `${relation.to.type}:${relation.to.id}`;
    if (!keys.has(from) || !keys.has(to)) continue;
    edges.push({ id: relation.id, from, to, kind: "evidence", type: relation.type,
      directed: true, status: relation.status });
  }
  return edges;
}

function lifecycleEdges(db, keys) {
  const edges = [];
  for (const row of db.prepare("SELECT source_id, target_id, relation FROM memory_relations ORDER BY source_id, target_id, relation").iterate()) {
    const from = `memory:${row.source_id}`;
    const to = `memory:${row.target_id}`;
    if (!keys.has(from) || !keys.has(to)) continue;
    if (edges.some((edge) => edge.from === to && edge.to === from && edge.type === row.relation)) continue;
    edges.push({ id: `memory:${row.source_id}:${row.target_id}:${row.relation}`, from, to,
      kind: "lifecycle", type: row.relation, directed: row.relation !== "coexists_with" });
  }
  return edges;
}
