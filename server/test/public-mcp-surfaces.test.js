import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createBackend } from "../src/backend.js";
import { openDatabase } from "../src/database.js";
import { createMemoryServer } from "../src/mcp/memory-server.js";
import { ADMIN_TOOL_NAMES, RUNTIME_TOOL_NAMES } from "../src/mcp/surfaces.js";

async function listedTools(db, surface) {
  const server = createMemoryServer(db, { surface });
  const client = new Client({ name: `surface-${surface}`, version: "1" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return (await client.listTools()).tools.map(tool => tool.name).sort();
  } finally {
    await client.close();
    await server.close();
  }
}

test("runtime and admin MCP surfaces expose explicit bounded inventories", async () => {
  const { db } = openDatabase(":memory:");
  try {
    const runtime = await listedTools(db, "runtime");
    const admin = await listedTools(db, "admin");
    const compat = await listedTools(db, "compat");
    assert.deepEqual(runtime, [...RUNTIME_TOOL_NAMES].sort());
    assert.deepEqual(admin, [...ADMIN_TOOL_NAMES].sort());
    assert.ok(runtime.includes("moss_recall"));
    assert.ok(runtime.includes("moss_memory_intent"));
    assert.ok(!runtime.includes("moss_delete_memory"));
    assert.ok(admin.includes("moss_delete_memory"));
    assert.ok(admin.includes("moss_recall_trace"));
    assert.ok(!admin.includes("moss_recall"));
    assert.ok(new Set(compat).size > new Set(runtime).size);
    assert.ok([...new Set([...runtime, ...admin])].every(name => compat.includes(name)));
  } finally {
    db.close();
  }
});

test("runtime token cannot open admin or compatibility MCP surfaces", async () => {
  const directory = mkdtempSync(join(tmpdir(), "moss-mcp-surfaces-"));
  const adminToken = "synthetic-admin-token-for-surface-test";
  const runtimeToken = "synthetic-runtime-token-for-surface-test";
  const backend = createBackend({ databasePath: join(directory, "db.sqlite"), adminToken, runtimeToken });
  const http = backend.app.listen(0, "127.0.0.1");
  await once(http, "listening");
  const base = `http://127.0.0.1:${http.address().port}`;
  const connect = async (path, token) => {
    const client = new Client({ name: `http-${path}`, version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}${path}`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }));
    return client;
  };
  try {
    const runtime = await connect("/mcp/runtime", runtimeToken);
    try {
      const tools = (await runtime.listTools()).tools.map(tool => tool.name);
      assert.ok(tools.includes("moss_recall"));
      assert.ok(!tools.includes("moss_lifecycle_apply"));
    } finally {
      await runtime.close();
    }
    await assert.rejects(connect("/mcp/admin", runtimeToken));
    await assert.rejects(connect("/mcp", runtimeToken));
    const admin = await connect("/mcp/admin", adminToken);
    try {
      const tools = (await admin.listTools()).tools.map(tool => tool.name);
      assert.ok(tools.includes("moss_lifecycle_apply"));
      assert.ok(!tools.includes("moss_recall"));
    } finally {
      await admin.close();
    }
    const legacy = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(legacy.headers.get("deprecation"), "true");
    assert.match(legacy.headers.get("warning"), /deprecated/);
    assert.match(legacy.headers.get("link"), /mcp\/runtime/);
  } finally {
    await new Promise(resolve => http.close(resolve));
    await backend.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
