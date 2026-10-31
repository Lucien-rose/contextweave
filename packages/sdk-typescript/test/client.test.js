import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextWeave, ContextWeaveAdmin, ApiError, TransportError } from "../dist/index.js";
import { createBackend } from "../../../server/src/backend.js";
import { getMemory, writeMemory } from "../../../server/src/database.js";
import { runSdkExample } from "../../../examples/sdk/run.js";

const runtimeToken = "synthetic-sdk-runtime-token", adminToken = "synthetic-sdk-admin-token";
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "contextweave-sdk-"));
  const backend = createBackend({ databasePath: join(directory, "db.sqlite"), runtimeToken, adminToken });
  const server = backend.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await backend.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { ...backend, baseUrl, moss: new ContextWeave({ baseUrl, token: runtimeToken }) };
}

const intent = {
  change_id: "sdk:create", family_key: "sdk:harbor", title: "Harbor launch",
  content: "Harbor launch color is cobalt blue.",
  source_refs: [{ source_type: "example", source_id: "sdk:message" }],
};

test("SDK follows real write, review, replay, evolution and HTTP error contracts", async t => {
  const { moss, baseUrl } = await fixture(t);
  const pending = await moss.ingest(intent);
  assert.equal(pending.data.status, "review_required");
  assert.equal(pending.data.canonical_memories_changed, false);
  const admin = new ContextWeaveAdmin({ baseUrl, token: adminToken });
  assert.equal((await admin.reviews()).data.reviews.length, 1);
  await assert.rejects(new ContextWeaveAdmin({ baseUrl, token: runtimeToken }).reviews(), error =>
    error instanceof ApiError && error.status === 403 && error.code === "forbidden");
  const input = { ...intent, authority: "user_correction", user_instruction: "Save this synthetic record." };
  const { data: saved } = await moss.ingest(input);
  assert.equal(saved.status, "applied");
  assert.equal((await moss.ingest(input)).data.replay, true);
  await assert.rejects(moss.ingest({ ...input, content: "Different" }), error =>
    error instanceof ApiError && error.status === 409 && Boolean(error.requestId));
  const { data: memory } = await moss.read({ memory_id: saved.memory_id, query: "Harbor launch" });
  assert.equal(memory.available, true);
  const edit = { ...input, change_id: "sdk:edit", operation: "supersede", lifecycle_class: "belief", risk: "low",
    content: "Harbor launch color is forest green.", target_memory_id: saved.memory_id,
    expected_content_hash: memory.content_hash, expected_updated_at: memory.updated_at };
  assert.equal((await moss.evolve(edit)).data.status, "applied");
  assert.equal((await moss.evolve({ ...edit, change_id: "sdk:stale" })).data.status, "review_required");
  assert.equal((await moss.change({ change_id: "sdk:edit" })).data.change_id, "sdk:edit");
  await assert.rejects(moss.recall({ query: "test", typo: true }), error =>
    error instanceof ApiError && error.status === 400 && error.issues.length > 0);
  await assert.rejects(new ContextWeave({ baseUrl, token: "wrong" }).bootstrap(), error =>
    error instanceof ApiError && error.status === 401);
});

test("SDK end-to-end example, recall parity, gated read and receipt semantics", async t => {
  const { moss, baseUrl, db } = await fixture(t);
  const saved = await runSdkExample({ baseUrl, token: runtimeToken });
  assert.equal(getMemory(db, saved.memory_id).recall_count, 1);
  const input = { query: "do not recall", recall_control: { mode: "no_recall" }, jev_mode: "off", vector_mode: "off" };
  const sdk = await moss.recall(input);
  const http = await (await fetch(`${baseUrl}/api/v1/recall`, { method: "POST",
    headers: { Authorization: `Bearer ${runtimeToken}`, "Content-Type": "application/json" }, body: JSON.stringify(input) })).json();
  const { receipt: sdkReceipt, ...sdkData } = sdk.data;
  const { receipt: httpReceipt, ...httpData } = http.data;
  assert.deepEqual(sdkData, httpData);
  assert.equal(sdkReceipt.status, "empty");
  assert.equal(httpReceipt.status, "empty");
  const admin = new ContextWeaveAdmin({ baseUrl, token: adminToken });
  assert.equal((await admin.receipt({ receipt_id: sdkReceipt.receipt_id })).data.query, input.query);
  assert.equal(sdk.data.route, "NO_RECALL");
  assert.equal((await moss.bootstrap()).data.schema_version, 3);
  writeMemory(db, { id: "sdk:sealed", title: "Private agreement", content: "Synthetic sealed text.",
    sensitivity: "intimate", scope: "private_relationship", egress_policy: "local_only" });
  assert.equal((await moss.read({ memory_id: "sdk:sealed", query: "Private agreement" })).data.available, false);
  await assert.rejects(moss.acknowledge({ receipt_id: "delivery:missing", memory_ids: [saved.memory_id] }), error =>
    error instanceof ApiError && error.status === 410);
});

test("transport preserves mounted paths and meta, supports CJS, and classifies failures", async () => {
  const commonjs = createRequire(import.meta.url)("../dist/cjs/index.js");
  assert.equal(typeof commonjs.ContextWeave, "function");
  let seen;
  const moss = new ContextWeave({ baseUrl: "https://example.test/moss", token: runtimeToken, fetch: async (url, init) => {
    seen = { url: url.href, init };
    return Response.json({ api_version: "1", data: { memories: [] }, meta: { request_id: "synthetic", recall_status: { mode: "off" } } });
  } });
  assert.deepEqual((await moss.recall({ query: "Harbor" })).meta.recall_status, { mode: "off" });
  assert.equal(seen.url, "https://example.test/moss/api/v1/recall");
  assert.equal(seen.init.redirect, "error");
  assert.equal(seen.init.headers.Authorization, `Bearer ${runtimeToken}`);
  const circular = { query: "Harbor" };
  circular.self = circular;
  await assert.rejects(moss.recall(circular), TypeError);
  for (const [fetcher, code] of [
    [async () => { throw new TypeError("offline"); }, "network"],
    [async () => new Response("not JSON", { status: 502 }), "invalid_response"],
    [async () => Response.json({ api_version: "2", data: {}, meta: {} }), "invalid_response"],
  ]) {
    await assert.rejects(new ContextWeave({ baseUrl: "https://example.test", token: runtimeToken, fetch: fetcher }).schema(), error =>
      error instanceof TransportError && error.code === code);
  }
});

test("timeout and caller cancellation include response-body consumption and never retry", async t => {
  const { baseUrl } = await fixture(t);
  let calls = 0;
  const fetcher = async (_url, { signal }) => {
    calls++;
    return new Response(new ReadableStream({ start(controller) {
      signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      if (signal.aborted) controller.error(signal.reason);
    } }));
  };
  const moss = new ContextWeave({ baseUrl, token: runtimeToken, fetch: fetcher, timeoutMs: 15 });
  await assert.rejects(moss.schema(), error => error instanceof TransportError && error.code === "timeout");
  const controller = new AbortController();
  const result = moss.schema({ signal: controller.signal, timeoutMs: 5000 });
  controller.abort();
  await assert.rejects(result, error => error instanceof TransportError && error.code === "aborted");
  assert.equal(calls, 2);
});
