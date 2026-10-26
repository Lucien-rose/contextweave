import { discoverRelations } from "../../relation/discovery.js";
import { json, readJson } from "../http.js";
import { listRelations, proposeRelation, readRelation, reviewRelation } from "../../relation/service.js";
import { relationPaths } from "../../relation/paths.js";
import { relationBundle } from "../../relation/bundle.js";

// Owner API and MCP share the same projection and per-hop permission checks.
const OWNER = { context: "intimate", intimacy_mode: "on" };

export function createRelationRoutes({ db }) {
  return async (req, res, url) => {
    const path = url.pathname;
    if (path === "/api/relations/discover" && req.method === "POST") {
      return json(res, 200, discoverRelations(db, { ...await readJson(req), ...OWNER }));
    }
    if (path === "/api/relations/bundle" && req.method === "POST") {
      return json(res, 200, relationBundle(db, { ...await readJson(req), ...OWNER }));
    }
    if (path === "/api/relations/paths" && req.method === "POST") {
      return json(res, 200, relationPaths(db, { ...await readJson(req), ...OWNER }));
    }
    if (path === "/api/relations") {
      if (req.method === "POST") return json(res, 201, proposeRelation(db, await readJson(req), "owner"));
      if (req.method === "GET") {
        const { node_type, node_id, ...query } = Object.fromEntries(url.searchParams);
        const options = Object.fromEntries(Object.entries(query).map(([key, value]) =>
          [key, ["limit", "offset"].includes(key) ? Number(value) : value]));
        return json(res, 200, listRelations(db, { ...options, node: { type: node_type, id: node_id }, ...OWNER }));
      }
    }
    const match = path.match(/^\/api\/relations\/([^/]+)(\/review)?$/);
    if (match) {
      const relation_id = decodeURIComponent(match[1]);
      if (!match[2] && req.method === "GET") return json(res, 200, readRelation(db, {
        ...Object.fromEntries(url.searchParams), relation_id, ...OWNER,
      }));
      if (match[2] && req.method === "POST") return json(res, 200, reviewRelation(db, { ...await readJson(req), relation_id }, "owner"));
    }
    return json(res, 404, { error: "Not found" });
  };
}
