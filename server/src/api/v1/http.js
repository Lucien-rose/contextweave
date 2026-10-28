import { randomUUID } from "node:crypto";
import express from "express";
import { describeApi, operations } from "./contract.js";
import { createApiService } from "./service.js";

const codes = { 400: "invalid_request", 401: "unauthorized", 403: "forbidden", 404: "not_found",
  405: "method_not_allowed", 409: "conflict", 410: "gone", 413: "payload_too_large", 415: "unsupported_media_type" };

export function createV1Router({ db, core, authenticate }) {
  const router = express.Router({ caseSensitive: true, strict: true });
  const service = createApiService({ db, core });
  router.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Request-ID", res.locals.requestId);
    res.locals.role = authenticate(req);
    if (!res.locals.role) return fail(res, 401, "A valid Bearer token is required");
    next();
  });
  router.get("/schema", (_req, res) => send(res, describeApi()));
  for (const operation of operations) {
    router[operation.method.toLowerCase()](operation.path, (req, res, next) => {
      if (operation.role === "admin" && res.locals.role !== "admin") return fail(res, 403, "Admin credentials are required");
      if (operation.schema && !req.is("application/json")) return fail(res, 415, "Use Content-Type: application/json");
      next();
    }, express.json({ limit: "256kb", strict: false }), async (req, res) => {
      const parsed = operation.schema?.safeParse(req.body);
      if (parsed && !parsed.success) return fail(res, 400, "Request validation failed", parsed.error.issues.map(({ path, code, message }) => ({ path, code, message })));
      const { data, hostStatus } = await service[operation.name](parsed?.data);
      send(res, data, hostStatus ? { recall_status: hostStatus } : {});
    });
  }
  router.use((req, res) => {
    const known = operations.filter(operation => operation.path === req.path);
    const allow = req.path === "/schema" ? ["GET"] : known.map(operation => operation.method);
    if (allow.length) {
      res.setHeader("Allow", allow.join(", "));
      return fail(res, 405, "Method is not supported for this endpoint");
    }
    fail(res, 404, "Endpoint not found");
  });
  router.use((error, _req, res, _next) => {
    const status = error.statusCode || error.status || 500;
    if (status >= 500) console.error("API v1 failed", { request_id: res.locals.requestId, name: error.name });
    const message = status >= 500 ? "Internal server error"
      : error.type === "entity.parse.failed" ? "Invalid JSON body"
      : status === 413 ? "Request body is too large" : error.publicMessage || "Invalid request";
    fail(res, status, message);
  });
  return router;
}

function send(res, data, meta = {}) {
  res.json({ api_version: "1", data, meta: { request_id: res.locals.requestId, ...meta } });
}

function fail(res, status, message, issues) {
  res.status(status).json({ api_version: "1", error: {
    code: codes[status] || "internal_error", message, ...(issues ? { issues } : {}),
  }, meta: { request_id: res.locals.requestId } });
}
