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

export function createBackend({ databasePath, token = process.env.MOSS_ADMIN_TOKEN } = {}) {
  if (!token || token.length < 24) throw new Error("MOSS_ADMIN_TOKEN must contain at least 24 characters");
  const expected = Buffer.from(token);
  const { db } = openDatabase(databasePath);
  const stop = startMaintenance(db);
  const app = express();
  const router = createMemoryApiRouter({ db, memoryCore: createMemoryCore(db), continuityCore: createContinuityCore(db) });
  app.get("/health", (_req, res) => res.json({ ok: true, version: VERSION }));
  app.use((req, res, next) => {
    const supplied = Buffer.from((req.headers.authorization || "").replace(/^Bearer /, ""));
    if (!req.headers.authorization?.startsWith("Bearer ") || supplied.length !== expected.length
      || !timingSafeEqual(supplied, expected)) return json(res, 401, { error: "Unauthorized" });
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.post("/mcp", express.json({ limit: "256kb" }), async (req, res) => {
    const server = createMemoryServer(db);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request failed", error);
      if (!res.headersSent) json(res, 500, { error: "Internal server error" });
    }
  });
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
  if (process.argv.includes("--stdio")) {
    const { db } = openDatabase();
    const stop = startMaintenance(db);
    const server = createMemoryServer(db);
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
