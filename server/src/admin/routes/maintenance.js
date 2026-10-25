import { z } from "zod/v4";
import { parseContract } from "../../lib/contract.js";
import { json, readJson } from "../http.js";
import { healthStatus, healthRuns, runHealthCheck } from "../../health/checks.js";
import {
  beginVectorMigration, cancelVectorMigration, retirePreviousGeneration,
  switchVectorGeneration, vectorDeploymentStatus,
} from "../../vector/deployment.js";
import { compareVectorGenerations, syncVectorIndex } from "../../vector/migration.js";

const revisionInput = z.object({ expected_revision: z.number().int().positive() }).strict();
const startInput = z.object({
  connection_id: z.string().min(1), mode: z.enum(["dual", "forced"]).default("dual"),
}).strict();
const syncInput = z.object({
  batchSize: z.number().int().min(1).max(256).default(32),
  maxBatches: z.number().int().min(1).max(1000).default(16),
}).strict();
const switchInput = revisionInput.extend({ check_id: z.string().optional() });
const healthInput = z.object({ scope: z.enum(["daily", "weekly"]).default("daily") }).strict();

export function createMaintenanceRoutes({ db }) {
  return async (req, res, url) => {
    const path = url.pathname;
    if (req.method === "GET") {
      if (path === "/api/health/status") return json(res, 200, healthStatus(db));
      if (path === "/api/health/runs") return json(res, 200, { runs: healthRuns(db) });
      if (path === "/api/vector/migration") return json(res, 200, vectorDeploymentStatus(db));
    }
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
    const input = await readJson(req);
    let result;
    switch (path) {
      case "/api/health/run":
        result = await runHealthCheck(db, parseContract(healthInput, input));
        break;
      case "/api/vector/migration/start":
        result = beginVectorMigration(db, parseContract(startInput, input));
        break;
      case "/api/vector/migration/sync":
        result = await syncVectorIndex(db, parseContract(syncInput, input));
        break;
      case "/api/vector/migration/compare":
        result = await compareVectorGenerations(db, input);
        break;
      case "/api/vector/migration/switch":
      case "/api/vector/migration/rollback":
        result = switchVectorGeneration(db, {
          ...parseContract(switchInput, input), rollback: path.endsWith("/rollback"),
        });
        break;
      case "/api/vector/migration/cancel":
        result = cancelVectorMigration(db, parseContract(revisionInput, input).expected_revision);
        break;
      case "/api/vector/migration/retire":
        result = retirePreviousGeneration(db, parseContract(revisionInput, input).expected_revision);
        break;
      default:
        return json(res, 404, { error: "Not found" });
    }
    return json(res, 200, result);
  };
}
