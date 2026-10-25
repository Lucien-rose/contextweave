import { buildMemoryArchive } from "../../archive.js";
import { createMaintenanceRoutes } from "./maintenance.js";
import { createDoctorRoutes } from "./doctor.js";
import { createWindowCapsuleRoutes } from "./window-capsules.js";
import { createModelRoutes } from "./models.js";
import { createPortraitRoutes } from "./portraits.js";
import { createRelationRoutes } from "./relations.js";
import { createEntityRoutes } from "./entities.js";
import { createArcRoutes } from "./arcs.js";
import { createEvolutionRoutes } from "./evolution.js";
import { createGatewayRoutes } from "./gateway.js";
import { createMemoryRoutes } from "./memory.js";
import { createVectorRoutes } from "./vector.js";
import { json } from "../http.js";

export function createMemoryApiRouter(ctx) {
  const routes = [
    [["/api/health", "/api/vector/migration"], createMaintenanceRoutes(ctx)],
    [["/api/doctor"], createDoctorRoutes(ctx)],
    [["/api/window-capsules"], createWindowCapsuleRoutes(ctx)],
    [["/api/models"], createModelRoutes(ctx)],
    [["/api/portraits"], createPortraitRoutes(ctx)],
    [["/api/relations"], createRelationRoutes(ctx)],
    [["/api/entities"], createEntityRoutes(ctx)],
    [["/api/arcs"], createArcRoutes(ctx)],
    [["/api/evolution"], createEvolutionRoutes(ctx)],
    [["/api/gateway", "/api/sync"], createGatewayRoutes(ctx)],
    [["/api/memories", "/api/drafts"], createMemoryRoutes(ctx)],
    [["/api/vector"], createVectorRoutes(ctx)],
  ];
  return async (req, res, url) => {
    if (req.method === "GET" && url.pathname === "/api/export") return json(res, 200, buildMemoryArchive(ctx.db, ctx.memoryCore, ctx.continuityCore));
    if (req.method === "GET" && url.pathname === "/api/session") return json(res, 200, { ok: true });
    if (req.method === "GET" && url.pathname === "/api/stats") return json(res, 200, { stats: ctx.memoryCore.stats() });
    const route = routes.find(([prefixes]) => prefixes.some(prefix => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)));
    return route ? route[1](req, res, url) : json(res, 404, { error: "Not found" });
  };
}
