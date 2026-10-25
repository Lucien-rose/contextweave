import { createPortraitCore } from "../../portrait/core.js";
import { json, readJson } from "../http.js";
import { observePortrait, saveRuntimeSettings, retryPortraitJob } from "../../portrait/queue.js";
import { portraitRuntimeStatus } from "../../portrait/status.js";
import { runPortraitWorker } from "../../portrait/worker.js";
import { enqueuePortraitBackfill } from "../../portrait/backfill.js";
import { listPortraitCandidates, closePortraitCandidate, readPortraitCandidate } from "../../portrait/proposals.js";

export function createPortraitRoutes({ db }) {
  const portraits = createPortraitCore(db);
  return async (req, res, url) => {
    if (req.method === "GET" && url.pathname === "/api/portraits/runtime") return json(res, 200, portraitRuntimeStatus(db));
    if (req.method === "PUT" && url.pathname === "/api/portraits/runtime") return json(res, 200, saveRuntimeSettings(db, await readJson(req)));
    if (req.method === "GET" && url.pathname === "/api/portraits/candidates") return json(res, 200, {
      candidates: listPortraitCandidates(db, { status: url.searchParams.get("status") || "pending", limit: url.searchParams.get("limit") }) });
    const candidate = url.pathname.match(/^\/api\/portraits\/candidates\/([^/]+)$/);
    if (req.method === "GET" && candidate) return json(res, 200, readPortraitCandidate(db, decodeURIComponent(candidate[1]), {
      maxChars: url.searchParams.get("max_chars"), sourceId: url.searchParams.get("source_id"), offset: url.searchParams.get("offset") }));
    if (req.method === "PATCH" && candidate) return json(res, 200, closePortraitCandidate(db,
      decodeURIComponent(candidate[1]), (await readJson(req)).status));
    const retry = url.pathname.match(/^\/api\/portraits\/jobs\/([^/]+)\/retry$/);
    if (req.method === "POST" && retry) return json(res, 200, retryPortraitJob(db, decodeURIComponent(retry[1])));
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
    const input = await readJson(req);
    if (url.pathname === "/api/portraits/observe") return json(res, 202, observePortrait(db, input));
    if (url.pathname === "/api/portraits/run") return json(res, 200, await runPortraitWorker(db, { force: true }));
    if (url.pathname === "/api/portraits/backfill") return json(res, 202, { jobs: enqueuePortraitBackfill(db, input) });
    if (url.pathname === "/api/portraits/read") return json(res, 200, portraits.read(input));
    if (url.pathname === "/api/portraits/update") return json(res, 200, portraits.update(input));
    if (url.pathname === "/api/portraits/seed") return json(res, 200, portraits.seed(input));
    return json(res, 404, { error: "Not found" });
  };
}
