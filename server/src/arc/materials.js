import { getMemory } from "../database.js";
import { admissionDecision } from "../recall/admission.js";

const MEMORY_STATUSES = ["active", "archived", "superseded"];
const TARGETS = {
  memory: ["memories", "id"],
  family: ["memories", "family_key"],
  handoff: ["continuity_handoffs", "id"],
  source: ["source_materials", "id"],
};

export function arcMaterialExists(db, type, id) {
  const [table, key] = TARGETS[type];
  return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE ${key} = ?`).get(id));
}

export function privateArcVisible(sensitivity, { context, intimacy_mode, explicit_navigation = false }) {
  if (!["private", "intimate"].includes(context)) return false;
  return sensitivity !== "intimate" || (intimacy_mode !== "off"
    && (context === "intimate" || ["on", "scene"].includes(intimacy_mode)
      || (explicit_navigation && ["model", "proactive"].includes(intimacy_mode))));
}

export function resolveArcMaterial(db, type, id, input) {
  if (type === "memory") return memoryMaterial(db, id, input);
  if (type === "family") return familyMaterial(db, id, input);
  if (type === "handoff") return handoffMaterial(db, id, input);
  return sourceMaterial(db, id, input);
}

function visibleMemory(memory, input) {
  return memory && admissionDecision(memory, {
    query: input.query, context: input.context, intimacyMode: input.intimacy_mode,
    allowedStatuses: MEMORY_STATUSES, modelInspection: Boolean(input.explicit_navigation),
  }).allowed;
}

function memoryMaterial(db, id, input) {
  const memory = getMemory(db, id);
  if (!visibleMemory(memory, input)) return null;
  return {
    title: memory.title, kind: memory.kind, status: memory.status,
    occurred_at: memory.event_date || memory.created_at,
    family_key: memory.family_key, content_hash: memory.content_hash,
    read_via: { tool: "moss_read", arguments: { memory_id: id } },
    search_text: `${memory.title}\n${memory.content}`,
  };
}

function familyMaterial(db, id, input) {
  const members = db.prepare(`SELECT id FROM memories WHERE family_key = ?
    ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC, id`).all(id)
    .map((row) => getMemory(db, row.id)).filter((memory) => visibleMemory(memory, input));
  if (!members.length) return null;
  return {
    title: id, kind: "family", status: "versioned",
    read_via: { tool: "moss_state", arguments: { memory_id: members[0].id } },
    search_text: members.map((memory) => `${memory.title}\n${memory.content}`).join("\n"),
  };
}

function handoffMaterial(db, id, input) {
  const handoff = db.prepare(`SELECT current_topic, status, sensitivity, occurred_at, created_at, purged_at
    FROM continuity_handoffs WHERE id = ?`).get(id);
  if (!handoff || handoff.purged_at || !privateArcVisible(handoff.sensitivity, input)) return null;
  // A reference does not extend retention or copy an expiring conversation tail.
  return {
    title: handoff.current_topic.slice(0, 200), kind: "handoff", status: handoff.status,
    occurred_at: handoff.occurred_at || handoff.created_at,
    search_text: handoff.current_topic,
  };
}

function sourceMaterial(db, id, input) {
  const source = db.prepare("SELECT * FROM source_materials WHERE id = ?").get(id);
  if (!source || !privateArcVisible(source.sensitivity, input)) return null;
  const owners = db.prepare("SELECT memory_id FROM memory_evidence WHERE material_id = ? ORDER BY memory_id").all(id);
  const owner = owners.map((row) => getMemory(db, row.memory_id)).find((memory) => visibleMemory(memory, input));
  if (owners.length && !owner) return null;
  return {
    title: `${source.source_type}: ${source.source_id}`, kind: "source", status: "immutable",
    occurred_at: source.occurred_at || source.created_at,
    content_hash: source.content_hash, content_version: source.content_version,
    ...(owner ? { read_via: { tool: "moss_source_context", arguments: {
      memory_id: owner.id, source_id: id, context: input.context, intimacy_mode: input.intimacy_mode,
    } } } : {}),
    search_text: source.content,
  };
}
