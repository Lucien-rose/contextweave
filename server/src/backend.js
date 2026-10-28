#!/usr/bin/env node
import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDatabase } from "./database.js";
import { createMemoryCore } from "./memory-core.js";
import { createContinuityCore } from "./continuity.js";
import { createMemoryServer } from "./mcp/memory-server.js";
import { createMemoryApiRouter } from "./admin/routes/memory-api.js";
import { startMaintenance } from "./maintenance.js";
import { json } from "./admin/http.js";
import { VERSION } from "./version.js";
import { createV1Router } from "./api/v1/http.js";

export function createBackend({
  databasePath,
  token = process.env.MOSS_ADMIN_TOKEN,
  adminToken = token,
  runtimeToken = process.env.MOSS_RUNTIME_TOKEN || adminToken,
} = {}) {
  validateToken(adminToken, "MOSS_ADMIN_TOKEN");
  validateToken(runtimeToken, "MOSS_RUNTIME_TOKEN");
  const { db } = openDatabase(databasePath);
  const stop = startMaintenance(db);
  const app = express();
  const core = createMemoryCore(db);
  const router = createMemoryApiRouter({ db, memoryCore: core, continuityCore: createContinuityCore(db) });
  app.get("/health", (_req, res) => res.json({ ok: true, version: VERSION }));
  app.use("/api/v1", createV1Router({ db, core, authenticate: req =>
    authorized(req, [adminToken]) ? "admin" : authorized(req, [runtimeToken]) ? "runtime" : null }));
  app.use((req, res, next) => {
    const accepted = req.path === "/mcp/runtime" ? [runtimeToken, adminToken] : [adminToken];
    if (!authorized(req, accepted)) return json(res, 401, { error: "Unauthorized" });
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const mcp = (surface, compatibility = false) => async (req, res) => {
    if (compatibility) {
      res.setHeader("Deprecation", "true");
      res.setHeader("Warning", '299 ContextWeave "The combined /mcp surface is deprecated; select /mcp/runtime or /mcp/admin"');
      res.setHeader("Link", '</mcp/runtime>; rel="successor-version", </mcp/admin>; rel="alternate"');
    }
    res.setHeader("X-ContextWeave-MCP-Surface", surface);
    const server = createMemoryServer(db, { surface });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request failed", error);
      if (!res.headersSent) json(res, 500, { error: "Internal server error" });
    }
  };
  const mcpJson = express.json({ limit: "256kb" });
  app.post("/mcp/runtime", mcpJson, mcp("runtime"));
  app.post("/mcp/admin", mcpJson, mcp("admin"));
  app.post("/mcp", mcpJson, mcp("compat", true));
  app.use(async (req, res) => {
    try {
      await router(req, res, new URL(req.url, "http://localhost"));
    } catch (error) {
      if ((error.statusCode || 500) >= 500) console.error("Owner API failed", error);
      if (!res.headersSent) json(res, error.statusCode || 500, { error: error.publicMessage || "Internal server error" });
    }
  });
  app.use((error, _req, res, _next) => json(res, error.status || 500, { error: error.status === 413 ? "Request body is too large" : "Invalid request" }));
  return { app, db, async close() { await stop(); db.close(); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.env.MOSS_CONFIG_DIR ||= resolve("data/config");
  const stdioSurface = process.argv.includes("--stdio-runtime") ? "runtime"
    : process.argv.includes("--stdio-admin") ? "admin"
      : process.argv.includes("--stdio") ? "compat" : null;
  if (stdioSurface) {
    const { db } = openDatabase();
    const stop = startMaintenance(db);
    if (stdioSurface === "compat") console.error("ContextWeave: --stdio uses the deprecated combined MCP surface; prefer --stdio-runtime or --stdio-admin");
    const server = createMemoryServer(db, { surface: stdioSurface });
    await server.connect(new StdioServerTransport());
    server.server.onclose = async () => { await stop(); db.close(); };
  } else {
    const host = process.env.MOSS_HTTP_HOST || "127.0.0.1";
    const backend = createBackend();
    const server = backend.app.listen(Number(process.env.MOSS_HTTP_PORT || 2091), host,
      () => console.error(`ContextWeave backend ${VERSION} listening on ${host}`));
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal,
      () => server.close(async () => { await backend.close(); process.exit(0); }));
  }
}

function validateToken(value, name) {
  if (!value || value.length < 24) throw new Error(`${name} must contain at least 24 characters`);
}

function authorized(req, tokens) {
  if (!req.headers.authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(req.headers.authorization.slice("Bearer ".length));
  return [...new Set(tokens)].some(token => {
    const expected = Buffer.from(token);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}
