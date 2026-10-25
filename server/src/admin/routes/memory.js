import { randomUUID } from "node:crypto";
import { editMemory } from "../../evolution/edit.js";
import { normalizeDraft, layerForImportance } from "../memory-input.js";
import { setMemorySummary } from "../../memory-summaries.js";
import { readMemoryHistory } from "../memory-history.js";
import { arcsForMemory } from "../arc-atlas.js";
import { assignStarfield, starfieldFor, validateStarfield } from "../../starfield/service.js";
import {
  json, pick, publicMemory, readJson, badRequest,
} from "../http.js";

const ALLOWED_SENSITIVITY = new Set(["personal", "private", "sensitive", "intimate"]);

export function createMemoryRoutes({ memoryCore, db }) {
  return async function handleMemoryRoutes(req, res, requestUrl) {
    const path = requestUrl.pathname;
    const starfieldMatch = path.match(/^\/api\/memories\/([^/]+)\/starfield$/);
    if (starfieldMatch && req.method === "PUT") {
      return json(res, 200, assignStarfield(db, decodeURIComponent(starfieldMatch[1]), (await readJson(req)).starfield));
    }
    const arcsMatch = path.match(/^\/api\/memories\/([^/]+)\/arcs$/);
    if (arcsMatch) {
      if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
      const result = arcsForMemory(db, decodeURIComponent(arcsMatch[1]));
      return result ? json(res, 200, result) : json(res, 404, { error: "Memory not found" });
    }
    const historyMatch = path.match(/^\/api\/memories\/([^/]+)\/history$/);
    if (historyMatch) {
      if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
      const history = readMemoryHistory(db, memoryCore, decodeURIComponent(historyMatch[1]));
      return history ? json(res, 200, history) : json(res, 404, { error: "Memory not found" });
    }
    const summaryMatch = path.match(/^\/api\/memories\/([^/]+)\/summary$/);
    if (summaryMatch && req.method === "PUT") return json(res, 200, setMemorySummary(db, {
      ...await readJson(req), memory_id: decodeURIComponent(summaryMatch[1]),
    }));
    if (req.method === "GET" && path === "/api/memories") {
      const memories = memoryCore.list({
        status: pick(requestUrl.searchParams.get("status"), ["active", "paused", "draft", "archived", "superseded", "all"], "active"),
        layer: pick(requestUrl.searchParams.get("layer"), ["core", "context", "archive", "all"], "all"),
        starfield: requestUrl.searchParams.get("starfield") || "all",
        kind: pick(requestUrl.searchParams.get("kind"), ["memory", "quote", "handoff", "all"], "all"),
        sensitivity: pick(requestUrl.searchParams.get("sensitivity"), [...ALLOWED_SENSITIVITY, "all"], "all"),
        query: requestUrl.searchParams.get("query") || "",
        limit: requestUrl.searchParams.get("limit") || 100,
        offset: requestUrl.searchParams.get("offset") || 0,
      });
      return json(res, 200, { memories: memories.map(publicMemory) });
    }
    const sourceContextMatch = path.match(/^\/api\/memories\/([^/]+)\/source-context$/);
    if (req.method === "GET" && sourceContextMatch) {
      const memoryId = decodeURIComponent(sourceContextMatch[1]);
      const offset = requestUrl.searchParams.has("offset") ? Number(requestUrl.searchParams.get("offset")) : null;
      if (offset !== null && (!Number.isSafeInteger(offset) || offset < 0 || !requestUrl.searchParams.get("source_id"))) {
        throw badRequest("Source paging requires a source_id and a nonnegative integer offset");
      }
      const sourceContext = memoryCore.ownerSourceContext({
        memoryId,
        sourceId: requestUrl.searchParams.get("source_id") || null,
        maxChars: 50_000,
        view: "full",
        offset,
      });
      return sourceContext
        ? json(res, 200, sourceContext)
        : json(res, 404, { error: "Memory not found" });
    }
    if (req.method === "PUT" && sourceContextMatch) {
      const memoryId = decodeURIComponent(sourceContextMatch[1]);
      const input = await readJson(req);
      try {
        const focus = memoryCore.curateSourceContext({
          memoryId,
          sourceId: String(input.source_id || ""),
          expectedSourceHash: String(input.expected_source_hash || ""),
          ranges: input.ranges,
          updatedBy: "ashu",
        });
        return focus
          ? json(res, 200, { memory_id: memoryId, focus, original_material_changed: false })
          : json(res, 404, { error: "Memory not found" });
      } catch (error) {
        if (error instanceof TypeError) return json(res, 400, { error: error.message });
        throw error;
      }
    }
    const memoryMatch = path.match(/^\/api\/memories\/(.+)$/);
    if (req.method === "PUT" && memoryMatch) {
      const id = decodeURIComponent(memoryMatch[1]);
      const base = memoryCore.read(id);
      if (!base) return json(res, 404, { error: "Memory not found" });
      const input = await readJson(req);
      const fields = normalizeDraft(input, base);
      if (input.starfield) validateStarfield(input.starfield);
      const result = editMemory(db, id, { ...fields, layer: layerForImportance(fields.importance) }, input);
      if (input.starfield) assignStarfield(db, result.memory_id || result.memory?.id || id, input.starfield);
      return json(res, 200, result);
    }
    if (req.method === "GET" && memoryMatch) {
      const memory = memoryCore.read(decodeURIComponent(memoryMatch[1]));
      return memory ? json(res, 200, { memory: { ...publicMemory(memory), starfield: starfieldFor(db, memory.id) } }) : json(res, 404, { error: "Memory not found" });
    }
    if (req.method === "POST" && path === "/api/drafts") {
      const input = await readJson(req);
      if (input.starfield) validateStarfield(input.starfield);
      const base = input.base_memory_id ? memoryCore.read(String(input.base_memory_id)) : null;
      if (input.base_memory_id && !base) return json(res, 404, { error: "Base memory not found" });
      const draftInput = normalizeDraft(input, base);
      const draft = memoryCore.draft({
        ...draftInput,
        id: `draft:${randomUUID()}`,
        layer: layerForImportance(draftInput.importance),
        kind: draftInput.requested_kind,
        status: "draft",
        supersedes_id: base?.id || null,
        source_section: "owner-api",
      });
      if (input.starfield && input.starfield !== "unnamed") assignStarfield(db, draft.id, input.starfield);
      return json(res, 201, { draft: publicMemory(draft), requires_confirmation: true });
    }
    const commitMatch = path.match(/^\/api\/drafts\/(.+)\/commit$/);
    if (req.method === "POST" && commitMatch) {
      const body = await readJson(req);
      if (body.confirmation !== true) return json(res, 400, { error: "Explicit confirmation is required" });
      const { memory: committed, family_judgment } = await memoryCore.commitWithFamily(decodeURIComponent(commitMatch[1]));
      return committed
        ? json(res, 200, { memory: publicMemory(committed), committed: true, family_judgment })
        : json(res, 404, { error: "Active draft not found" });
    }
    const archiveMatch = path.match(/^\/api\/memories\/(.+)\/archive$/);
    if (req.method === "POST" && archiveMatch) {
      const body = await readJson(req);
      if (body.confirmation !== true) return json(res, 400, { error: "Explicit confirmation is required" });
      const archived = memoryCore.archive(decodeURIComponent(archiveMatch[1]));
      return archived
        ? json(res, 200, { memory: publicMemory(archived), archived: true })
        : json(res, 404, { error: "Active memory or draft not found" });
    }
    return json(res, 404, { error: "Not found" });
  };
}

