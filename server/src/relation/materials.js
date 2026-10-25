import { getMemory } from "../database.js";
import { createHash } from "node:crypto";
import { resolveArcMaterial, privateArcVisible } from "../arc/materials.js";
import { withRecallSettings } from "../recall/settings.js";
import { publicError } from "../lib/error.js";

export const nodeKey = ({ type, id }) => `${type}:${id}`;

export function navigationPolicy(db, request) {
  const { intimacyMode } = withRecallSettings(db, { intimacyMode: request.intimacy_mode });
  return { ...request, intimacy_mode: intimacyMode, explicit_navigation: true };
}

export function originalNode(db, node, namespace) {
  const row = node.type === "memory" ? getMemory(db, node.id)
    : db.prepare(`SELECT * FROM ${node.type === "entity" ? "entities" : "source_materials"} WHERE id = ?`).get(node.id);
  if (!row || (node.type === "entity" && row.namespace !== namespace)
    || (node.type === "memory" && !["active", "archived", "superseded"].includes(row.status))) {
    throw publicError("Relation material unavailable", 404);
  }
  return { ...row, version: row.version ?? row.content_version ?? 1 };
}

export function visibleNode(db, node, request) {
  if (!["private", "intimate"].includes(request.context)) return null;
  if (node.type === "entity") {
    const row = db.prepare("SELECT * FROM entities WHERE id = ? AND namespace = ?").get(node.id, request.namespace);
    if (!row || !privateArcVisible(row.sensitivity, request)) return null;
    return { ...node, title: row.display_name, kind: row.type, namespace: row.namespace,
      read_via: { tool: "moss_entity_read", arguments: { entity_id: node.id, namespace: request.namespace,
        context: request.context, intimacy_mode: request.intimacy_mode } } };
  }
  const material = resolveArcMaterial(db, node.type, node.id, request);
  if (!material) return null;
  const { search_text, ...header } = material;
  const original = originalNode(db, node, request.namespace);
  return { ...node, ...header, version: original.version,
    occurred_at: node.type === "memory" ? original.event_date : original.occurred_at,
    written_at: original.created_at };
}

export function pinEvidence(db, ref, namespace) {
  const original = originalNode(db, ref, namespace);
  if (ref.content_hash !== original.content_hash) throw publicError("Evidence content hash is stale", 409);
  const start = ref.start ?? original.content.indexOf(ref.excerpt);
  const end = start + ref.excerpt.length;
  if (start < 0 || original.content.slice(start, end) !== ref.excerpt) {
    throw publicError("Evidence excerpt does not match the original");
  }
  if (ref.start === undefined && original.content.indexOf(ref.excerpt, start + 1) !== -1) {
    throw publicError("Evidence excerpt is ambiguous; provide its exact start offset");
  }
  return { type: ref.type, id: ref.id, content_hash: original.content_hash,
    version: original.version, start, end, snippet_hash: digest(ref.excerpt), sensitivity: original.sensitivity };
}

export function projectRelation(db, row, request, { excerpts = false } = {}) {
  if (row.namespace !== request.namespace || !privateArcVisible(row.sensitivity, request)) return null;
  const from = visibleNode(db, { type: row.from_type, id: row.from_id }, request);
  const to = visibleNode(db, { type: row.to_type, id: row.to_id }, request);
  if (!from || !to) return null;
  let fresh = !row.pin_endpoints || ((!row.from_hash || (from.content_hash === row.from_hash && from.version === row.from_version))
    && (!row.to_hash || (to.content_hash === row.to_hash && to.version === row.to_version)));
  const evidence = [];
  for (const ref of db.prepare("SELECT * FROM relation_evidence WHERE relation_id = ? ORDER BY position").all(row.id)) {
    const node = { type: ref.material_type, id: ref.material_id };
    const visible = visibleNode(db, node, request);
    if (!visible) return null;
    const original = originalNode(db, node, request.namespace);
    const excerpt = original.content.slice(ref.start, ref.end);
    const valid = ref.snippet_hash ? excerpt.length === ref.end - ref.start && digest(excerpt) === ref.snippet_hash
      : original.content_hash === ref.content_hash && original.version === ref.version;
    fresh &&= valid;
    evidence.push({ ...node, content_hash: ref.content_hash, version: ref.version, start: ref.start, end: ref.end,
      snippet_hash: ref.snippet_hash, current_content_hash: original.content_hash, current_version: original.version,
      state: valid ? "valid" : "stale", read_via: visible.read_via ?? null,
      ...(excerpts && valid ? { excerpt } : {}),
    });
  }
  return { id: row.id, namespace: row.namespace, type: row.type, from, to,
    from_version: row.from_version, to_version: row.to_version,
    from_content_hash: row.from_hash, to_content_hash: row.to_hash,
    explanation: row.explanation, status: row.status, proposed_by: row.proposed_by, pin_endpoints: Boolean(row.pin_endpoints),
    valid_from: row.valid_from, valid_until: row.valid_until,
    temporal_status: row.valid_from || row.valid_until ? "bounded" : "unknown",
    evidence_state: fresh && evidence.length ? "valid" : "stale", evidence,
    created_at: row.created_at, updated_at: row.updated_at,
    usage: "evidence-navigation-only", answer_authority_granted: false,
  };
}

export function evidenceFingerprint(relation) {
  return digest(JSON.stringify({ pin_endpoints: relation.pin_endpoints, evidence: relation.evidence.map(
    ({ type, id, content_hash, version, start, end, snippet_hash, state }) =>
      ({ type, id, content_hash, version, start, end, snippet_hash, state })) }));
}

export function activeAt(relation, asOf) {
  return !asOf || ((!relation.valid_from || relation.valid_from <= asOf)
    && (!relation.valid_until || relation.valid_until >= asOf));
}

function digest(text) {
  return createHash("sha256").update(text).digest("hex");
}
