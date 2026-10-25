import { json, readJson } from "../http.js";
import {
  archiveArc, attachArcMaterial, createArc, detachArcMaterial, listArcMaterials,
  listArcs, readArc, renameArc,
} from "../../arc/service.js";
import { readArcAtlas, readGlobalAtlas } from "../arc-atlas.js";
import { assignStarfields } from "../../starfield/service.js";
import { classifyStarfields } from "../../starfield/classify.js";

// These routes run after owner authentication, like the existing memory editor.
const OWNER_CONTEXT = { context: "intimate", intimacy_mode: "scene" };

export function createArcRoutes({ db }) {
  return async (req, res, url) => {
    const path = url.pathname;
    if (path === "/api/arcs/atlas" && req.method === "GET") return json(res, 200, readGlobalAtlas(db));
    if (path === "/api/arcs/starfields" && req.method === "PUT") {
      return json(res, 200, { assignments: assignStarfields(db, (await readJson(req)).assignments) });
    }
    if (path === "/api/arcs/classify" && req.method === "POST") return json(res, 200, await classifyStarfields(db));
    if (path === "/api/arcs") {
      if (req.method === "POST") return json(res, 201, createArc(db, await readJson(req)));
      if (req.method === "GET") return json(res, 200, listArcs(db, { ...queryOptions(url), ...OWNER_CONTEXT }));
    }
    const match = path.match(/^\/api\/arcs\/([^/]+)(?:\/(archive|materials|atlas))?$/);
    if (!match) return json(res, 404, { error: "Not found" });
    const arc_id = decodeURIComponent(match[1]);
    if (!match[2]) {
      if (req.method === "GET") return json(res, 200, readArc(db, { arc_id, ...OWNER_CONTEXT }));
      if (req.method === "PATCH") return json(res, 200, renameArc(db, { ...await readJson(req), arc_id }));
    }
    if (match[2] === "archive" && req.method === "POST") return json(res, 200, archiveArc(db, { arc_id }));
    if (match[2] === "materials") {
      if (req.method === "GET") return json(res, 200, listArcMaterials(db, { ...queryOptions(url), arc_id, ...OWNER_CONTEXT }));
      if (req.method === "PUT") return json(res, 200, attachArcMaterial(db, { ...await readJson(req), arc_id }));
      if (req.method === "DELETE") return json(res, 200, detachArcMaterial(db, { ...await readJson(req), arc_id }));
    }
    if (match[2] === "atlas" && req.method === "GET") {
      return json(res, 200, readArcAtlas(db, arc_id));
    }
    return json(res, 404, { error: "Not found" });
  };
}

function queryOptions(url) {
  return Object.fromEntries([...url.searchParams].map(([key, value]) =>
    [key, ["limit", "offset"].includes(key) ? Number(value) : value]));
}
