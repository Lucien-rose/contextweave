import { json, readJson } from "../http.js";
import { linkEntity, listEntities, readEntity, saveEntity } from "../../entity/service.js";

export function createEntityRoutes({ db }) {
  return async (req, res, url) => {
    const owner = { context: "private", intimacy_mode: "on" };
    if (url.pathname === "/api/entities") {
      if (req.method === "GET") return json(res, 200, listEntities(db, {
        ...owner, query: url.searchParams.get("query") || "",
        namespace: url.searchParams.get("namespace") || "real",
        limit: Number(url.searchParams.get("limit") || 20), offset: Number(url.searchParams.get("offset") || 0),
      }));
      if (req.method === "POST") return json(res, 200, saveEntity(db, await readJson(req)));
    }
    const match = url.pathname.match(/^\/api\/entities\/([^/]+)(\/memories)?$/);
    if (!match) return false;
    const entity_id = decodeURIComponent(match[1]);
    if (!match[2] && req.method === "GET") return json(res, 200, readEntity(db, {
      entity_id, ...owner, namespace: url.searchParams.get("namespace") || "real",
    }));
    if (match[2] && req.method === "PUT") return json(res, 200, linkEntity(db, { ...await readJson(req), entity_id }));
    return false;
  };
}
