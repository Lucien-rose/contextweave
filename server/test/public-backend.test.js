import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createBackend } from "../src/backend.js";
import { openDatabase, writeMemory, getMemory } from "../src/database.js";
import { createPortraitCore } from "../src/portrait/core.js";
import { backupDatabase, restoreDatabase } from "../../scripts/database-backup.js";
import { VERSION } from "../src/version.js";

test("standalone backend serves owner writes and real MCP recall without private application tables", async () => {
  const directory = mkdtempSync(join(tmpdir(), "moss-backend-"));
  const token = "synthetic-owner-token-for-local-test";
  const backend = createBackend({ databasePath: join(directory, "db.sqlite"), token });
  const server = backend.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = new Client({ name: "backend-test", version: "1" });
  try {
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true, version: VERSION });
    assert.equal((await fetch(`${base}/api/stats`)).status, 401);
    const update = await fetch(`${base}/api/portraits/update`, { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ change_id: "test:portrait", item_id: "learning", expected_revision: 0,
        operation: "upsert", data: { domain: "cognitive", time_scale: "stable", title: "Learning",
          content: "Prefer examples." }, source_refs: [{ source_type: "conversation", source_id: "test:message" }] }) });
    assert.equal(update.status, 200, await update.text());
    writeMemory(backend.db, { id: "test:cobalt", title: "Cobalt release", content: "Use staged deployment." });
    assert.equal(backend.db.prepare("SELECT name FROM sqlite_master WHERE name='reading_books'").get(), undefined);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }));
    const tools = await client.listTools();
    assert.ok(tools.tools.some(tool => tool.name === "moss_recall"));
    assert.ok(tools.tools.some(tool => tool.name === "moss_profile_lookup"));
    assert.ok(tools.tools.every(tool => !/^(reading_|gallery_|lookout_)/.test(tool.name)));
    const result = await client.callTool({ name: "moss_read", arguments: { memory_id: "test:cobalt" } });
    assert.equal(result.isError, undefined);
    assert.match(JSON.stringify(result), /Use staged deployment/);
    assert.ok(tools.tools.some(tool => tool.name === "moss_family_plan"));
    assert.ok(tools.tools.some(tool => tool.name === "moss_relation_discover"));
    const recallInput = { query: "Cobalt release", jev_mode: "on", vector_mode: "off", delivery_mode: "confirmed",
      recall_scope: { client: "test", surface: "window" } };
    const recalled = await client.callTool({ name: "moss_recall", arguments: recallInput });
    assert.equal(recalled._meta.recall_status.jev_status, "not-configured");
    assert.doesNotMatch(JSON.stringify(recalled.content), /not-configured|fallback_used/);
    const httpRecall = await fetch(`${base}/api/gateway/recall`, { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(recallInput) });
    const payload = await httpRecall.json();
    assert.equal(httpRecall.status, 200);
    assert.equal(payload.host_status.fallback_used, true);
    assert.equal(payload.memories[0].id, "test:cobalt");

  } finally {
    await client.close();
    await new Promise(resolve => server.close(resolve));
    await backend.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("database snapshot restores all stored rows, and reopening preserves explicitly empty ambient triggers", () => {
  const directory = mkdtempSync(join(tmpdir(), "moss-restore-"));
  const path = join(directory, "live.sqlite");
  let { db } = openDatabase(path);
  const rows = database => Object.fromEntries(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '%_fts%' AND name NOT LIKE '%situation_shadow%' ORDER BY name").all()
    .map(({ name }) => [name, database.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
  try {
    writeMemory(db, { id: "test:memory", title: "Test", content: "Canonical text", triggers: ["Test"], ambient_triggers: [] });
    createPortraitCore(db).update({ change_id: "test:change", item_id: "test:item", operation: "upsert", expected_revision: 0,
      data: { domain: "cognitive", time_scale: "stable", title: "Learning", content: "Examples." },
      source_refs: [{ source_type: "conversation", source_id: "test:source" }] });
    const before = rows(db);
    backupDatabase(path, join(directory, "backup.sqlite"));
    restoreDatabase(join(directory, "backup.sqlite"), join(directory, "restored.sqlite"));
    const restored = new DatabaseSync(join(directory, "restored.sqlite"), { readOnly: true });
    try { assert.deepEqual(rows(restored), before); } finally { restored.close(); }
    db.close(); db = openDatabase(path).db;
    assert.deepEqual(getMemory(db, "test:memory").ambient_triggers, []);
    assert.deepEqual(rows(db), before);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
