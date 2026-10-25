import { randomUUID } from "node:crypto";
import { publicError } from "../lib/error.js";
import { parseContract } from "../lib/contract.js";
import { safeJsonArray } from "../lib/json.js";
import { containsText } from "../lib/text-match.js";
import { entityLinkSchema, entityListSchema, entityReadSchema, entityWriteSchema } from "./contract.js";
import { withRecallSettings } from "../recall/settings.js";

export function saveEntity(db, input) {
  const request = parseContract(entityWriteSchema, input);
  const id = request.entity_id || `entity:${randomUUID()}`;
  const previous = db.prepare("SELECT * FROM entities WHERE id = ?").get(id);
  if (request.entity_id && !previous) {
    throw publicError("Entity not found", 404);
  }
  const namespace = request.namespace ?? previous?.namespace ?? "real";
  if (previous && previous.namespace !== namespace) {
    throw publicError("Entity namespace is immutable; create a distinct identity", 409);
  }
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO entities(id, type, display_name, aliases_json, sensitivity, created_at, updated_at, namespace)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET type=excluded.type, display_name=excluded.display_name,
      aliases_json=excluded.aliases_json, sensitivity=excluded.sensitivity, updated_at=excluded.updated_at`)
    .run(id, request.type, request.display_name,
      JSON.stringify([...new Set(request.aliases ?? safeJsonArray(previous?.aliases_json))]),
      request.sensitivity ?? previous?.sensitivity ?? "private", now, now, namespace);
  return { entity: hydrate(db.prepare("SELECT * FROM entities WHERE id = ?").get(id)) };
}

export function listEntities(db, input = {}) {
  const request = parseContract(entityListSchema, input);
  const rows = visibleEntities(db, request).filter((entity) => !request.query
    || [entity.display_name, ...entity.aliases].some((name) => containsText(name, request.query)));
  const end = request.offset + request.limit;
  return { entities: rows.slice(request.offset, end), next_offset: end < rows.length ? end : null };
}

export function readEntity(db, input) {
  const request = parseContract(entityReadSchema, input);
  const entity = visibleEntities(db, request).find((item) => item.id === request.entity_id);
  if (!entity) throw publicError("Entity unavailable in this context", 404);
  return { entity };
}

export function linkEntity(db, input) {
  const { entity_id, memory_id, linked } = parseContract(entityLinkSchema, input);
  if (!db.prepare("SELECT 1 FROM entities WHERE id = ?").get(entity_id)
    || !db.prepare("SELECT 1 FROM memories WHERE id = ?").get(memory_id)) {
    throw publicError("Entity or memory not found", 404);
  }
  if (linked) db.prepare("INSERT OR IGNORE INTO memory_entities VALUES (?, ?)").run(entity_id, memory_id);
  else db.prepare("DELETE FROM memory_entities WHERE entity_id = ? AND memory_id = ?").run(entity_id, memory_id);
  return { entity_id, memory_id, linked, original_changed: false };
}

// Alias identity is candidate evidence only. It never rewrites the query,
// manufactures a relationship, or bypasses the memory's own admission policy.
export function entityCandidateIds(db, query, policy) {
  const entities = visibleEntities(db, { context: policy.context, intimacy_mode: policy.intimacyMode,
    namespace: policy.namespace ?? "real" });
  const matched = entities.filter((entity) => [entity.display_name, ...entity.aliases]
    .some((name) => containsText(query, name)));
  const result = new Map();
  const links = db.prepare("SELECT memory_id FROM memory_entities WHERE entity_id = ? ORDER BY memory_id");
  for (const entity of matched) {
    for (const { memory_id } of links.all(entity.id)) {
      const ids = result.get(memory_id) || [];
      ids.push(entity.id);
      result.set(memory_id, ids);
    }
  }
  return result;
}

function visibleEntities(db, { context, intimacy_mode, namespace }) {
  intimacy_mode = withRecallSettings(db, { intimacyMode: intimacy_mode }).intimacyMode;
  if (!["private", "intimate"].includes(context)) return [];
  return db.prepare("SELECT * FROM entities WHERE namespace = ? ORDER BY display_name, id").all(namespace)
    .filter((row) => row.sensitivity !== "intimate"
      || (intimacy_mode !== "off" && (intimacy_mode === "on" || intimacy_mode === "scene" || context === "intimate")))
    .map(hydrate);
}

function hydrate({ aliases_json, ...row }) {
  return { ...row, aliases: safeJsonArray(aliases_json) };
}
