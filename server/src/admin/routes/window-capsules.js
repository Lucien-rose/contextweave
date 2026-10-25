import { json, readJson } from "../http.js";
import { publishWindowCapsule, readWindowCapsule, windowCapsuleCatalog } from "../../window/store.js";
import { organizeWindowCapsule } from "../../window/organizer.js";

export function createWindowCapsuleRoutes({ db }) {
  return async (req, res, url) => {
    if (req.method === "GET" && url.pathname === "/api/window-capsules/catalog") {
      const input = Object.fromEntries(url.searchParams);
      for (const key of ["limit", "offset"]) if (key in input) input[key] = Number(input[key]);
      return json(res, 200, windowCapsuleCatalog(db, input));
    }
    if (req.method === "POST") {
      const input = await readJson(req);
      if (url.pathname === "/api/window-capsules/publish") return json(res, 200, publishWindowCapsule(db, input));
      if (url.pathname === "/api/window-capsules/read") return json(res, 200, readWindowCapsule(db, input));
      if (url.pathname === "/api/window-capsules/organize") return json(res, 200, await organizeWindowCapsule(db, input));
    }
    return json(res, 405, { error: "Unsupported window capsule operation" });
  };
}
