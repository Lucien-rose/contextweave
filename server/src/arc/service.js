import { randomUUID } from "node:crypto";
import { parseContract } from "../lib/contract.js";
import { publicError } from "../lib/error.js";
import { transaction } from "../lib/transaction.js";
import {
  arcAttachSchema, arcCreateSchema, arcIdSchema, arcListSchema, arcMaterialRefSchema,
  arcMaterialsSchema, arcReadSchema, arcRenameSchema,
} from "./contract.js";
import { arcMaterialExists, privateArcVisible, resolveArcMaterial } from "./materials.js";

export function createArc(db, input) {
  const { title, sensitivity } = parseContract(arcCreateSchema, input);
  const id = `arc:${randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare("INSERT INTO arcs(id, title, sensitivity, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, title, sensitivity, now, now);
  return { arc: getArc(db, id) };
}

export function readArc(db, input) {
  const request = parseContract(arcReadSchema, input);
  return { arc: visibleArc(db, request) };
}

export function listArcs(db, input = {}) {
  const request = parseContract(arcListSchema, input);
  const rows = db.prepare(`SELECT * FROM arcs WHERE (? = 'all' OR status = ?)
    ORDER BY updated_at DESC, id`).all(request.status, request.status);
  const visible = rows.filter((arc) => privateArcVisible(arc.sensitivity, request)
    && matchesQuery(arc.title, request.query));
  return page(visible, request, "arcs");
}

export function renameArc(db, input) {
  const { arc_id, title } = parseContract(arcRenameSchema, input);
  requireActiveArc(db, arc_id);
  db.prepare("UPDATE arcs SET title = ?, updated_at = ? WHERE id = ?")
    .run(title, new Date().toISOString(), arc_id);
  return { arc_id, title };
}

export function archiveArc(db, input) {
  const { arc_id } = parseContract(arcIdSchema, input);
  getArc(db, arc_id);
  db.prepare("UPDATE arcs SET status = 'archived', updated_at = ? WHERE id = ? AND status != 'archived'")
    .run(new Date().toISOString(), arc_id);
  return { arc_id, status: "archived", materials_changed: false };
}

export function attachArcMaterial(db, input) {
  const request = parseContract(arcAttachSchema, input);
  return transaction(db, () => {
    requireActiveArc(db, request.arc_id);
    if (!arcMaterialExists(db, request.material_type, request.material_id)) {
      throw publicError("Atlas material not found", 404);
    }
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO arc_materials(arc_id, material_type, material_id, chapter, position, attached_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(arc_id, material_type, material_id) DO UPDATE SET chapter = excluded.chapter, position = excluded.position`)
      .run(request.arc_id, request.material_type, request.material_id, request.chapter, request.position, now);
    db.prepare("UPDATE arcs SET updated_at = ? WHERE id = ?").run(now, request.arc_id);
    return { ...request, attached: true };
  });
}

export function detachArcMaterial(db, input) {
  const request = parseContract(arcMaterialRefSchema, input);
  return transaction(db, () => {
    requireActiveArc(db, request.arc_id);
    const removed = db.prepare("DELETE FROM arc_materials WHERE arc_id = ? AND material_type = ? AND material_id = ?")
      .run(request.arc_id, request.material_type, request.material_id).changes;
    if (removed) db.prepare("UPDATE arcs SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), request.arc_id);
    return { ...request, detached: Boolean(removed), original_changed: false };
  });
}

export function listArcMaterials(db, input) {
  const request = parseContract(arcMaterialsSchema, input);
  visibleArc(db, request);
  const rows = db.prepare(`SELECT material_type, material_id, chapter, position, attached_at
    FROM arc_materials WHERE arc_id = ? AND (? IS NULL OR chapter = ?)
    ORDER BY position, attached_at, material_type, material_id`)
    .all(request.arc_id, request.chapter ?? null, request.chapter ?? null);
  const selected = [];
  // Filter each original before matching or pagination; hidden records neither
  // disclose a count nor consume visible slots. No Atlas label enters recall.
  for (const row of rows) {
    const material = resolveArcMaterial(db, row.material_type, row.material_id, request);
    if (!material) continue;
    const { search_text, ...summary } = material;
    if (!matchesQuery(`${row.chapter}\n${summary.title}\n${search_text}`, request.query)) continue;
    selected.push({ ...row, ...summary });
    if (selected.length > request.offset + request.limit) break;
  }
  return { arc_id: request.arc_id, usage: "navigation-only", ...page(selected, request, "materials") };
}

function getArc(db, id) {
  const arc = db.prepare("SELECT * FROM arcs WHERE id = ?").get(id);
  if (!arc) throw publicError("Atlas not found", 404);
  return { ...arc };
}

function visibleArc(db, request) {
  const arc = getArc(db, request.arc_id);
  if (!privateArcVisible(arc.sensitivity, request)) throw publicError("Atlas unavailable in this context", 403);
  return arc;
}

function requireActiveArc(db, id) {
  const arc = getArc(db, id);
  if (arc.status !== "active") throw publicError("Archived Atlas is read-only", 409);
  return arc;
}

function matchesQuery(text, query) {
  return text.normalize("NFKC").toLowerCase().includes(query.normalize("NFKC").toLowerCase());
}

function page(rows, { offset, limit }, key) {
  const hasMore = rows.length > offset + limit;
  return { [key]: rows.slice(offset, offset + limit), next_offset: hasMore ? offset + limit : null };
}
