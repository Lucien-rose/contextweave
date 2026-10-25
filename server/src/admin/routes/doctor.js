import { json, readJson } from "../http.js";
import { submitDoctorBatch, doctorBatchReceipt } from "../../doctor/batches.js";
import { runDoctorBatch } from "../../doctor/worker.js";
import { retryPortraitJob } from "../../portrait/queue.js";

export function createDoctorRoutes({ db }) {
  return async (req, res, url) => {
    if (req.method === "POST" && url.pathname === "/api/doctor/batches") return json(res, 202, submitDoctorBatch(db, await readJson(req)));
    if (req.method === "POST" && url.pathname === "/api/doctor/run") return json(res, 200, await runDoctorBatch(db));
    const match = url.pathname.match(/^\/api\/doctor\/batches\/([^/]+)(\/retry)?$/);
    if (match) {
      const receipt = doctorBatchReceipt(db, decodeURIComponent(match[1]));
      if (req.method === "GET" && !match[2]) return json(res, 200, receipt);
      if (req.method === "POST" && match[2]) return json(res, 200, retryPortraitJob(db, receipt.job_id));
    }
    return json(res, 405, { error: "Unsupported Steward operation" });
  };
}
