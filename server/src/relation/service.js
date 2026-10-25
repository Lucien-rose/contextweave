import { randomUUID } from "node:crypto";
import { parseContract } from "../lib/contract.js";
import { publicError } from "../lib/error.js";
import { transaction } from "../lib/transaction.js";
import { relationListSchema, relationProposeSchema, relationReadSchema, relationReviewSchema } from "./contract.js";
import { navigationPolicy, originalNode, pinEvidence, projectRelation, visibleNode } from "./materials.js";

export function proposeRelation(db, input, proposedBy = "host") {
  const request = parseContract(relationProposeSchema, input);
  return transaction(db, () => {
    const from = originalNode(db, request.from, request.namespace);
    const to = originalNode(db, request.to, request.namespace);
    if (request.valid_from && request.valid_until && request.valid_from > request.valid_until) {
      throw publicError("Relation validity range is reversed");
    }
    if (request.type === "participates_in" && (request.from.type !== "entity" || request.to.type !== "memory")) {
      throw publicError("Participation requires entity -> memory");
    }
    if (["explicitly_influences", "contradicts"].includes(request.type)
      && (request.from.type !== "memory" || request.to.type !== "memory")) {
      throw publicError("Influence and contradiction require memory -> memory");
    }
    const evidence = request.evidence.map((ref) => pinEvidence(db, ref, request.namespace));
    const sensitivity = [request, from, to, ...evidence].some((item) => item.sensitivity === "intimate") ? "intimate" : "private";
    const id = `relation:${randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO relation_assertions(id, namespace, type, from_type, from_id, from_hash, from_version,
      to_type, to_id, to_hash, to_version, explanation, sensitivity, proposed_by, valid_from, valid_until, created_at, updated_at, pin_endpoints)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, request.namespace, request.type, request.from.type, request.from.id, from.content_hash ?? null, from.version,
      request.to.type, request.to.id, to.content_hash ?? null, to.version, request.explanation,
      sensitivity, proposedBy, request.valid_from, request.valid_until, now, now, Number(request.pin_endpoints),
    );
    const insert = db.prepare(`INSERT INTO relation_evidence(relation_id, position, material_type, material_id,
      content_hash, version, start, end, snippet_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    evidence.forEach((ref, index) => insert.run(id, index, ref.type, ref.id, ref.content_hash, ref.version, ref.start, ref.end, ref.snippet_hash));
    return { relation_id: id, status: "proposed", updated_at: now, original_changed: false };
  });
}

export function reviewRelation(db, input, reviewedBy = "host") {
  const request = parseContract(relationReviewSchema, input);
  return transaction(db, () => {
    const row = db.prepare("SELECT * FROM relation_assertions WHERE id = ?").get(request.relation_id);
    if (!row) throw publicError("Relation unavailable", 404);
    if (row.updated_at !== request.expected_updated_at) throw publicError("Relation review snapshot is stale", 409);
    if (row.status === "withdrawn") throw publicError("Withdrawn relations are immutable; propose a replacement", 409);
    if (request.status === "accepted") {
      const policy = navigationPolicy(db, { context: "intimate", intimacy_mode: "on", namespace: row.namespace, query: "" });
      if (projectRelation(db, row, policy)?.evidence_state !== "valid") {
        throw publicError("Only available relations with current pinned evidence can be accepted", 409);
      }
    }
    const now = new Date(Math.max(Date.now(), Date.parse(row.updated_at) + 1)).toISOString();
    db.prepare("UPDATE relation_assertions SET status = ?, updated_at = ? WHERE id = ?")
      .run(request.status, now, row.id);
    db.prepare("INSERT INTO relation_reviews(relation_id, status, reviewed_by, reason, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(row.id, request.status, reviewedBy, request.reason, now);
    return { relation_id: row.id, status: request.status, reviewed_by: reviewedBy, updated_at: now, original_changed: false };
  });
}

export function readRelation(db, input) {
  const request = navigationPolicy(db, parseContract(relationReadSchema, input));
  const row = db.prepare("SELECT * FROM relation_assertions WHERE id = ?").get(request.relation_id);
  const relation = row && projectRelation(db, row, request, { excerpts: true });
  if (!relation) throw publicError("Relation unavailable in this context", 404);
  const reviews = db.prepare("SELECT status, reviewed_by, reason, created_at FROM relation_reviews WHERE relation_id = ? ORDER BY id DESC LIMIT 21")
    .all(row.id);
  return { relation: { ...relation, reviews: reviews.slice(0, 20).reverse(), reviews_truncated: reviews.length > 20 } };
}

export function listRelations(db, input) {
  const request = navigationPolicy(db, parseContract(relationListSchema, input));
  if (!visibleNode(db, request.node, request)) return { relations: [], next_offset: null };
  const visible = [];
  // The work cap is never reported as a hidden-neighbor count or pagination hint.
  let inspected = 0;
  for (const row of adjacentRows(db, request.node, request.namespace)) {
    if (++inspected > 512) break;
    if (request.status !== "all" && row.status !== request.status) continue;
    const relation = projectRelation(db, row, request);
    if (relation) visible.push(relation);
    if (visible.length > request.offset + request.limit) break;
  }
  return { relations: visible.slice(request.offset, request.offset + request.limit),
    next_offset: visible.length > request.offset + request.limit ? request.offset + request.limit : null,
    coverage: "bounded-search",
  };
}

export function adjacentRows(db, node, namespace) {
  return db.prepare(`SELECT * FROM relation_assertions WHERE namespace = ?
    AND ((from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)) ORDER BY created_at, id`)
    .iterate(namespace, node.type, node.id, node.type, node.id);
}
