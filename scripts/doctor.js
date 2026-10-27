#!/usr/bin/env node
import { accessSync, constants, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { resolveDatabasePath } from "../server/src/database.js";
import { modelSettingsPaths, createModelSettingsStore } from "../server/src/models/settings.js";
import { activeVectorIndex } from "../server/src/vector/deployment.js";
import { vectorEnvValue } from "../server/src/vector-settings.js";
import { qdrantHealth } from "../server/src/vector-store.js";
import { withMcp } from "./mcp-client.js";

export async function diagnose({ baseUrl = process.env.MOSS_BASE_URL || `http://127.0.0.1:${process.env.MOSS_HTTP_PORT || 2091}`,
  dbPath = resolveDatabasePath(), adminToken = process.env.MOSS_ADMIN_TOKEN,
  runtimeToken = process.env.MOSS_RUNTIME_TOKEN || adminToken } = {}) {
  const checks = [];
  const check = async (name, repair, run) => {
    try { checks.push({ name, status: "ok", detail: await run() }); }
    catch { checks.push({ name, status: "fail", repair }); }
  };
  await check("storage", "Run npm run init; give the service user read/write access to the database and config directories.", () => {
    accessSync(dirname(dbPath), constants.R_OK | constants.W_OK);
    accessSync(process.env.MOSS_CONFIG_DIR || resolve("data/config"), constants.R_OK | constants.W_OK);
    return "Database and config directories are writable";
  });
  await check("database", "Initialize the database with npm run init; if integrity fails, restore a verified backup.", () => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error();
      return `${db.prepare("SELECT COUNT(*) AS n FROM memories").get().n} memories; SQLite integrity OK`;
    } finally { db.close(); }
  });
  await check("models", "Run npm run init and check model settings/key permissions; keep the original models.key when restoring.", () => {
    const { keyPath } = modelSettingsPaths();
    if (!/^[a-f0-9]{64}$/i.test(readFileSync(keyPath, "utf8").trim())) throw new Error();
    const store = createModelSettingsStore();
    for (const connection of store.list()) store.get(connection.id);
    const count = Object.keys(store.routes()).length;
    return count ? `${count} model routes configured; credentials readable (no paid calls made)` : "Local recall ready; optional model routes not configured";
  });
  await check("http", "Start the backend; verify MOSS_BASE_URL, listening port and proxy configuration.", async () => {
    const response = await fetch(new URL("/health", baseUrl), { signal: AbortSignal.timeout(5000) });
    if (!response.ok || !(await response.json()).ok) throw new Error();
    return "Health endpoint reachable";
  });
  for (const [surface, token, required] of [["runtime", runtimeToken, "moss_recall"], ["admin", adminToken, "moss_recall_trace"]]) {
    await check(`mcp-${surface}`, `Check the ${surface} token (at least 24 characters), MCP path and proxy forwarding.`, async () => {
      if (!token || token.length < 24) throw new Error();
      return withMcp(baseUrl, surface, token, async client => {
        const { tools } = await client.listTools();
        if (!tools.some(tool => tool.name === required)) throw new Error();
        return `${tools.length} tools available`;
      });
    });
  }
  await check("vector", "Check embedding settings, active vector generation and Qdrant connectivity; run vector:sync after repair.", async () => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      if (vectorEnvValue("MOSS_RECALL_VECTOR_MODE", "off") === "off"
        && !db.prepare("SELECT 1 FROM vector_deployment WHERE id=1").get()) return "Optional vector recall disabled";
      const index = activeVectorIndex(db);
      const health = await qdrantHealth(index.store);
      if (!health.reachable) throw new Error();
      return "Qdrant reachable; embedding requests were not sent";
    } finally { db.close(); }
  });
  return { ok: checks.every(check => check.status === "ok"), checks };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.env.MOSS_CONFIG_DIR ||= resolve("data/config");
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--json")) {
    console.error("Usage: npm run doctor -- [--json]; set MOSS_BASE_URL for a remote/proxied endpoint.");
    process.exitCode = 1;
  } else {
    const report = await diagnose();
    console.log(args.includes("--json") ? JSON.stringify(report, null, 2)
      : report.checks.map(check => `${check.status === "ok" ? "OK" : "FAIL"} ${check.name}: ${check.detail || check.repair}`).join("\n"));
    process.exitCode = report.ok ? 0 : 1;
  }
}
