import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createBackend } from "../src/backend.js";
import { getMemory, writeMemory } from "../src/database.js";
import { setDelegationPolicy } from "../src/evolution/policy.js";
import { runHttpExample } from "../../examples/http/run.js";

const adminToken = "synthetic-api-v1-admin-token";
const runtimeToken = "synthetic-api-v1-runtime-token";

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "contextweave-api-v1-"));
  const backend = createBackend({ databasePath: join(directory, "db.sqlite"), adminToken, runtimeToken });
  const server = backend.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await backend.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, { body, method = body === undefined ? "GET" : "POST", token = runtimeToken,
    raw = body === undefined ? undefined : JSON.stringify(body), contentType = "application/json" } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": contentType,
    }, body: raw });
    const payload = await response.json();
    assert.equal(payload.api_version, "1");
    assert.equal(payload.meta.request_id, response.headers.get("x-request-id"));
    assert.equal(response.headers.get("cache-control"), "no-store");
    return { status: response.status, payload, allow: response.headers.get("allow") };
  };
  return { ...backend, base, request };
}

const intent = (change_id, content = "Harbor launch color is cobalt blue.") => ({
  change_id, family_key: "example:harbor", title: "Harbor launch", content,
  source_refs: [{ source_type: "conversation", source_id: "example:message", excerpt: content }],
  attributes: { sensitivity: "personal", triggers: ["Harbor launch"] },
});

test("v1 writes preserve delegation, replay and pinned evolution semantics", async t => {
  const { db, request } = await fixture(t);
  const pending = await request("/api/v1/ingest", { body: intent("example:pending") });
  assert.equal(pending.status, 200);
  assert.equal(pending.payload.data.status, "review_required");
  assert.equal(pending.payload.data.canonical_memories_changed, false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memories").get().n, 0);
  assert.equal((await request("/api/v1/admin/reviews", { token: adminToken })).payload.data.reviews.length, 1);

  setDelegationPolicy(db, { enabled: true, confirmation: true });
  const body = intent("example:create");
  const saved = (await request("/api/v1/ingest", { body })).payload.data;
  assert.equal(saved.status, "applied");
  const replay = await request("/api/v1/ingest", { body });
  assert.equal(replay.payload.data.memory_id, saved.memory_id);
  assert.equal(replay.payload.data.replay, true);
  assert.equal((await request("/api/v1/ingest", { body: { ...body, content: "Different" } })).status, 409);
  const original = (await request("/api/v1/read", { body: {
    memory_id: saved.memory_id, query: "Harbor launch", detail: "full",
  } })).payload.data;
  assert.equal(original.updated_at, getMemory(db, saved.memory_id).updated_at);
  const edit = { ...intent("example:edit", "Harbor launch color is forest green."), operation: "supersede",
    authority: "delegated", lifecycle_class: "belief", risk: "low", target_memory_id: original.id,
    expected_content_hash: original.content_hash, expected_updated_at: original.updated_at };
  const evolved = (await request("/api/v1/evolve", { body: edit })).payload.data;
  assert.equal(evolved.status, "applied");
  assert.equal(getMemory(db, original.id).status, "superseded");
  assert.match(getMemory(db, evolved.memory_id).content, /forest green/);
  const stale = (await request("/api/v1/evolve", { body: { ...edit, change_id: "example:stale" } })).payload.data;
  assert.equal(stale.status, "review_required");
  assert.equal(stale.canonical_memories_changed, false);
  const receipt = (await request("/api/v1/changes/read", { body: { change_id: "example:edit" } })).payload.data;
  assert.equal(receipt.memory_id, evolved.memory_id);
  assert.equal(receipt.before, undefined);
  assert.equal(receipt.after, undefined);
  const current = getMemory(db, evolved.memory_id);
  const staleHash = (await request("/api/v1/evolve", { body: { ...edit, change_id: "example:stale-hash",
    target_memory_id: current.id, expected_content_hash: original.content_hash,
    expected_updated_at: current.updated_at } })).payload.data;
  assert.equal(staleHash.reason, "stale_target");
  assert.equal(getMemory(db, current.id).content, current.content);
});

test("HTTP quickstart completes against a fresh backend without enabling delegation", async t => {
  const { db, base } = await fixture(t);
  const result = await runHttpExample({ baseUrl: base, token: runtimeToken });
  assert.equal(getMemory(db, result.memory_id).recall_count, 1);
  assert.equal(db.prepare("SELECT enabled FROM evolution_policy WHERE id = 1").get().enabled, 0);
});

test("v1 recall shares MCP defaults, separate background and confirmed delivery", async t => {
  const { db, request, base } = await fixture(t);
  writeMemory(db, { id: "example:cobalt", title: "Harbor launch", content: "Harbor launch color is cobalt blue.",
    sensitivity: "personal", triggers: ["Harbor launch"] });
  const client = new Client({ name: "api-v1-parity", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp/runtime", base), {
    requestInit: { headers: { Authorization: `Bearer ${runtimeToken}` } },
  }));
  t.after(() => client.close());
  const schema = (await request("/api/v1/schema")).payload.data;
  const mcpTools = (await client.listTools()).tools;
  for (const name of ["recall", "bootstrap"]) {
    const httpSchema = schema.operations.find(item => item.name === name).input;
    const mcpSchema = mcpTools.find(tool => tool.name === `moss_${name}`).inputSchema;
    assert.deepEqual(httpSchema.properties, mcpSchema.properties);
    assert.deepEqual(httpSchema.required, mcpSchema.required);
  }
  const body = { query: "Harbor launch", vector_mode: "off", jev_mode: "on", delivery_mode: "confirmed" };
  const http = (await request("/api/v1/recall", { body })).payload;
  const mcp = await client.callTool({ name: "moss_recall", arguments: body });
  const withoutReceipt = ({ delivery, ...data }) => data;
  assert.deepEqual(withoutReceipt(http.data), withoutReceipt(mcp.structuredContent));
  assert.equal(http.data.memories[0].id, "example:cobalt");
  assert.equal(http.data.background_mode, "separate");
  assert.ok(http.meta.recall_status);
  assert.equal(http.data.host_status, undefined);
  assert.equal(getMemory(db, "example:cobalt").recall_count, 0);
  const delivered = { receipt_id: http.data.delivery.receipt_id, memory_ids: ["example:cobalt"] };
  assert.equal((await request("/api/v1/recall/delivered", { body: delivered })).payload.data.recorded_count, 1);
  assert.equal((await request("/api/v1/recall/delivered", { body: delivered })).payload.data.duplicate, true);
  assert.equal(getMemory(db, "example:cobalt").recall_count, 1);
  const suppressed = (await request("/api/v1/recall", { body: { ...body, recall_control: { mode: "no_recall" } } })).payload.data;
  assert.equal(suppressed.route, "NO_RECALL");
  assert.deepEqual(suppressed.memories, []);
  assert.equal((await request("/api/v1/bootstrap", { body: {} })).payload.data.schema_version, 3);
});

test("v1 read applies context policy instead of exposing an owner read", async t => {
  const { db, request } = await fixture(t);
  writeMemory(db, { id: "example:sealed", title: "Private agreement", content: "Synthetic sealed agreement text.",
    sensitivity: "intimate", scope: "private_relationship", egress_policy: "local_only" });
  const body = { memory_id: "example:sealed", query: "Private agreement", detail: "full" };
  const sealed = (await request("/api/v1/read", { body })).payload.data;
  assert.equal(sealed.available, false);
  assert.equal(sealed.content, undefined);
  const opened = (await request("/api/v1/read", { body: { ...body, context: "private", intimacy_mode: "on" } })).payload.data;
  assert.equal(opened.available, true);
  assert.match(opened.content, /Synthetic sealed/);
  assert.equal((await request("/api/v1/read", { body: { ...body, memory_id: "missing" } })).status, 404);
});

test("v1 rejects wrong-role credentials and malformed requests with stable errors", async t => {
  const { db, request, base } = await fixture(t);
  for (const [path, options, status, code] of [
    ["/api/v1/schema", { token: "" }, 401, "unauthorized"],
    ["/api/v1/admin/reviews", {}, 403, "forbidden"],
    ["/api/v1/recall", { body: { query: "test", typo: true } }, 400, "invalid_request"],
    ["/api/v1/recall", { body: { query: "test" }, raw: "{" }, 400, "invalid_request"],
    ["/api/v1/recall", { body: { query: "test" }, raw: "null" }, 400, "invalid_request"],
    ["/api/v1/recall", { body: { query: "test" }, contentType: "text/plain" }, 415, "unsupported_media_type"],
    ["/api/v1/ingest", { body: intent("too-large", "x".repeat(270000)) }, 413, "payload_too_large"],
    ["/api/v1/evolve", { body: { ...intent("missing-target"), operation: "supersede" } }, 400, "invalid_request"],
    ["/api/v1/ingest", { body: { ...intent("bad-episode"), lifecycle_class: "episode" } }, 400, "invalid_request"],
    ["/api/v1/recall", {}, 405, "method_not_allowed"],
    ["/api/v1/unknown", {}, 404, "not_found"],
    ["/api/v1/recall/delivered", { body: { receipt_id: "delivery:missing", memory_ids: ["missing"] } }, 410, "gone"],
  ]) {
    const response = await request(path, options);
    assert.equal(response.status, status, path);
    assert.equal(response.payload.error.code, code, path);
    assert.equal(response.payload.data, undefined);
    if (status === 405) assert.equal(response.allow, "POST");
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memories").get().n, 0);
  for (const path of ["/api/stats", "/mcp/admin", "/mcp"]) {
    assert.equal((await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${runtimeToken}` } })).status, 401);
  }
});
