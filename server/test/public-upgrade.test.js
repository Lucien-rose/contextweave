import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, writeMemory, getMemory } from "../src/database.js";
import { recallMemoriesWithTrace } from "../src/recall/sqlite.js";
import { runSemanticRecall } from "../src/recall/semantic-runtime.js";
import { recallResponse } from "../src/recall/response.js";
import { recallForDelivery, acknowledgeRecallDelivery } from "../src/recall/delivery.js";
import { directReading } from "../src/recall/direct-reading.js";
import { memoryVectorDocuments } from "../src/vector-projection.js";
import { familySnapshot, groupFamily } from "../src/family/service.js";
import { proposeFamilyGroups } from "../src/family/proposal.js";
import { discoverRelations } from "../src/relation/discovery.js";
import { createModelSettingsStore, connectionFingerprint } from "../src/models/settings.js";
import { jevConfig } from "../src/jev/client.js";

function database(t) {
  const directory = mkdtempSync(join(tmpdir(), "cw-upgrade-"));
  const { db } = openDatabase(join(directory, "test.sqlite"));
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  return db;
}
const vector = ids => ({ enabled: true, mode: "on", items: ids.map((id, i) => ({ id, rank: i + 1, qualified: true, similarity: .9 })) });
const decision = (id, relevance = "useful", use = "supporting") => ({ candidate_id: id, relevance, use, context_fit: "appropriate", priority: 2 });
async function semantic(db, input, judge) {
  let status;
  const result = await runSemanticRecall(db, { recordRecall: false, context: "private", jevMode: "on", ...input,
    onRecallStatus: value => { status = value; } }, options => recallMemoriesWithTrace(db, options), {
    config: { available: true }, judge,
  });
  return { result, status };
}

test("long direct recall opens a relevant original window, with vector offsets preserved when available", t => {
  const db = database(t);
  const content = "Earlier unrelated details. ".repeat(140) + "\n\nZircon calibration uses violet filters.\n" + "Later filler. ".repeat(110);
  writeMemory(db, { id: "demo:long", title: "Zircon notebook", content, recall_summary: "Notebook overview." });
  const recalled = recallMemoriesWithTrace(db, { query: "Zircon notebook", recordRecall: false });
  const memory = recalled.memories.find(item => item.id === "demo:long");
  assert.equal(memory.detail_level, "relevant_chunk");
  assert.match(memory.content, /violet filters/);
  assert.equal(memory.content, content.slice(memory.chunk.start, memory.chunk.end));
  assert.ok(memory.content.length <= 1400);
  const original = getMemory(db, "demo:long");
  const docs = memoryVectorDocuments(original).filter(doc => doc.chunk_kind === "body");
  const selected = docs.at(-1);
  const result = directReading({ memory: original, vectorChunk: selected, readingQuery: "Later filler" });
  assert.equal(result.chunk.source, "vector-hit");
  assert.ok(result.chunk.start >= selected.chunk_start && result.chunk.end <= selected.chunk_end);
  assert.equal(result.content, content.slice(result.chunk.start, result.chunk.end));
});

test("semantic none is successful; provider failure uses the complete local route with host-only status", async t => {
  const db = database(t);
  writeMemory(db, { id: "demo:rain", title: "Rain shelter", content: "A sheltered place beside the lake." });
  const input = { query: "Where could we stop along the route?", vectorRecall: vector(["demo:rain"]) };
  const none = await semantic(db, input, async () => ({ decisions: [decision("demo:rain", "irrelevant", "omit")] }));
  assert.deepEqual(none.result.memories, []);
  assert.equal(none.status.fallback_used, false);
  const fallback = await semantic(db, input, async () => { throw new Error("provider unavailable"); });
  assert.ok(fallback.result.memories.some(item => item.id === "demo:rain"));
  assert.equal(fallback.status.fallback_used, true);
  assert.equal(fallback.status.jev_status, "provider-failed");
  assert.doesNotMatch(JSON.stringify(recallResponse(fallback.result, input)), /provider-failed|incident_id|host_status/);
});

test("semantic background rescue shares the 1–3 item lane and cannot bypass hard context gates", async t => {
  const db = database(t);
  const ids = [1, 2, 3, 4].map(number => `demo:soft${number}`);
  for (const id of ids) writeMemory(db, { id, title: id, content: `Private recollection ${id}.`,
    sensitivity: "intimate", scope: "private_relationship", activation_policy: "explicit_trigger", egress_policy: "local_only" });
  const judge = async snapshot => ({ decisions: snapshot.rows.map(row => decision(row.entry.memory.id)) });
  const input = { query: "A quiet moment now", intimacyMode: "model", vectorRecall: vector(ids) };
  const one = await semantic(db, input, judge);
  assert.equal(one.result.memories.length, 0);
  assert.equal(one.result.background_memories.length, 1);
  const three = await semantic(db, { ...input, backgroundLimit: 3, backgroundBudgetChars: 4000 }, judge);
  assert.equal(three.result.background_memories.length, 3);
  const blocked = await semantic(db, { ...input, context: "general" }, async () => { assert.fail("hard-gated bodies reached provider"); });
  assert.equal(blocked.result.memories.length + blocked.result.background_memories.length, 0);
});

test("confirmed surface cooldown is isolated, idempotent and body-version aware", t => {
  const db = database(t);
  writeMemory(db, { id: "demo:map", title: "Cobalt map", content: "Follow the northern path." });
  const input = { query: "Cobalt map", deliveryMode: "confirmed", recallScope: { client: "test", surface: "window-a" } };
  const first = recallForDelivery(db, input);
  assert.equal(recallForDelivery(db, input).memories.length, 1);
  const ack = { receiptId: first.delivery.receipt_id, memoryIds: ["demo:map"] };
  acknowledgeRecallDelivery(db, ack);
  assert.equal(acknowledgeRecallDelivery(db, ack).duplicate, true);
  assert.equal(recallForDelivery(db, input).memories.length, 0);
  assert.equal(recallForDelivery(db, { ...input, recallScope: { client: "test", surface: "window-b" } }).memories.length, 1);
  assert.equal(recallForDelivery(db, { ...input, allowRepeat: true }).memories.length, 1);
  writeMemory(db, { id: "demo:map", title: "Cobalt map", content: "Follow the southern path." });
  const revised = recallForDelivery(db, input);
  assert.equal(revised.memories.length, 1);
  acknowledgeRecallDelivery(db, { receiptId: revised.delivery.receipt_id, memoryIds: ["demo:map"] });
  assert.equal(recallForDelivery(db, input).memories.length, 0);
});

test("Lineage planning partitions revisions and sequences, surfaces contradictions, and applies with a current fingerprint", t => {
  const db = database(t);
  for (const id of ["a", "b", "c"]) writeMemory(db, { id: `demo:${id}`, title: id, content: `Event ${id}`, family_key: "demo:lineage" });
  const fingerprint = familySnapshot(db, "demo:lineage").fingerprint;
  const insert = (left, right, relation, suffix = "") => db.prepare(`INSERT INTO memory_family_judgments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(left + right + suffix, "demo:lineage", `demo:${left}`, `demo:${right}`, fingerprint, "test" + suffix, relation,
      relation === "revision" ? "same-subject-state" : "distinct-events", "{}", "test", new Date().toISOString());
  insert("a", "b", "revision"); insert("b", "c", "sequence");
  const plan = proposeFamilyGroups(db, { family_key: "demo:lineage" });
  assert.equal(plan.status, "ready");
  assert.deepEqual(plan.groups, [["demo:a", "demo:b"], ["demo:c"]]);
  insert("a", "c", "revision");
  assert.equal(proposeFamilyGroups(db, { family_key: "demo:lineage" }).status, "needs_review");
  db.prepare("DELETE FROM memory_family_judgments WHERE id = 'ac'").run();
  groupFamily(db, plan.apply_request);
  assert.throws(() => groupFamily(db, plan.apply_request), /changed/);
});

test("Atlas discovery returns pinned leads without creating relations or changing memories", t => {
  const db = database(t);
  for (const id of ["one", "two"]) writeMemory(db, { id: `demo:${id}`, title: id, content: `Original ${id} event.`, family_key: "demo:trip" });
  const before = db.prepare("SELECT total_changes() AS n").get().n;
  const result = discoverRelations(db, { memory_id: "demo:one", context: "private" });
  assert.equal(result.candidates[0].node.id, "demo:two");
  const evidence = result.candidates[0].evidence;
  assert.equal(getMemory(db, evidence.id).content.slice(evidence.start, evidence.start + evidence.excerpt.length), evidence.excerpt);
  assert.equal(db.prepare("SELECT total_changes() AS n").get().n, before);
});

test("recall, portrait review and Lineage model routes are independent with legacy fallback", t => {
  const directory = mkdtempSync(join(tmpdir(), "cw-routes-"));
  const old = { file: process.env.MOSS_MODEL_SETTINGS_FILE, key: process.env.MOSS_MODEL_KEY_FILE };
  process.env.MOSS_MODEL_SETTINGS_FILE = join(directory, "models.json");
  process.env.MOSS_MODEL_KEY_FILE = join(directory, "key");
  writeFileSync(process.env.MOSS_MODEL_KEY_FILE, "aa".repeat(32));
  t.after(() => {
    for (const [name, value] of [["MOSS_MODEL_SETTINGS_FILE", old.file], ["MOSS_MODEL_KEY_FILE", old.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const store = createModelSettingsStore();
  for (const id of ["legacy", "recall", "portrait"]) {
    store.save({ name: id, model: id, protocol: "decisions", base_url: "https://example.invalid", api_key: "synthetic", capabilities: ["decisions"] }, id);
    store.markTested(id, connectionFingerprint(store.get(id)), "decisions");
  }
  store.setRoute("jev", "legacy"); store.setRoute("recall_judge", "recall"); store.setRoute("portrait_judge", "portrait");
  assert.equal(jevConfig({ task: "recall_judge" }).model, "recall");
  assert.equal(jevConfig({ task: "portrait_judge" }).model, "portrait");
  assert.equal(jevConfig({ task: "lineage_judge" }).model, "legacy");
});
