import { createModelService } from "../../models/service.js";
import { json, readJson } from "../http.js";

export function createModelRoutes({ db }) {
  const models = createModelService({ db });
  return async (req, res, url) => {
    const match = url.pathname.match(/^\/api\/models\/connections(?:\/([^/]+)(\/test)?)?$/);
    if (match) {
      const id = match[1] ? decodeURIComponent(match[1]) : undefined;
      if (req.method === "GET" && !id) return json(res, 200, { connections: models.list() });
      if (req.method === "POST" && match[2]) {
        const input = await readJson(req, 32768);
        return json(res, 200, await models.test(id, input.capability));
      }
      if ((req.method === "POST" && !id) || (req.method === "PUT" && id && !match[2])) {
        return json(res, id ? 200 : 201, models.save(await readJson(req, 32768), id));
      }
      if (req.method === "DELETE" && id && !match[2]) return json(res, 200, models.remove(id));
    }
    if (url.pathname === "/api/models/routes" && req.method === "GET") return json(res, 200, { routes: models.routes() });
    const route = url.pathname.match(/^\/api\/models\/routes\/(portrait|summary|jev|embedding)$/);
    if (route && req.method === "PUT") {
      const input = await readJson(req);
      if (input.connection_id !== null && typeof input.connection_id !== "string") return json(res, 400, { error: "connection_id required (string or null)" });
      return json(res, 200, { routes: models.setRoute(route[1], input.connection_id) });
    }
    return json(res, 405, { error: "Unsupported model configuration operation" });
  };
}
