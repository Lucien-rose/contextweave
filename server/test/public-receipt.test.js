import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase, writeMemory, getMemory } from "../src/database.js";
import { recallForDelivery, acknowledgeRecallDelivery, pruneRecallDeliveries } from "../src/recall/delivery.js";
import { readRecallReceipt } from "../src/recall/receipt.js";
import { ensureRecallCooldown } from "../src/recall/cooldown.js";
import { selectBackground } from "../src/recall/background.js";
import { buildReceiptDetails } from "../src/recall/receipt.js";
import { deleteMemory } from "../src/evolution/deletion.js";
import { startMaintenance } from "../src/maintenance.js";

function fixture(t) {
  const { db } = openDatabase(":memory:");
  t.after(() => db.close());
  for (const id of ["north", "south"]) writeMemory(db, { id, title: `Cobalt ${id}`,
    content: `Cobalt route follows ${id}.`, sensitivity: "personal", triggers: ["Cobalt route"] });
  return db;
}

test("receipt pins titles and query without copying bodies; partial delivery stays idempotent", t => {
  const db = fixture(t);
  const result = recallForDelivery(db, { query: "Cobalt route", deliveryMode: "confirmed", familyPolicy: "allow-distinct" });
  assert.equal(result.receipt.receipt_id, result.delivery.receipt_id);
  const receiptId = result.receipt.receipt_id;
  const before = readRecallReceipt(db, receiptId);
  assert.equal(before.query, "Cobalt route");
  assert.equal(before.items.length, 2);
  assert.equal(before.status, "prepared");
  assert.equal(before.package_characters, JSON.stringify([...result.memories, ...result.background_memories]).length);
  const first = before.items[0];
  const ack = { receiptId, memoryIds: [first.memory_id], memoryPackageTokens: 135 };
  acknowledgeRecallDelivery(db, ack);
  assert.equal(acknowledgeRecallDelivery(db, ack).duplicate, true);
  const after = readRecallReceipt(db, receiptId);
  assert.equal(after.memory_package_tokens, 135);
  assert.equal(after.items.filter(item => item.result === "delivered").length, 1);
  assert.equal(after.items.filter(item => item.result === "not_delivered").length, 1);
  writeMemory(db, { ...getMemory(db, first.memory_id), title: "Revised title", content: "Revised body" });
  assert.equal(readRecallReceipt(db, receiptId).items[0].title, first.title);
  const stored = db.prepare("SELECT details_json FROM recall_deliveries WHERE id = ?").get(receiptId).details_json;
  assert.ok(!stored.includes("Cobalt route follows"));
  assert.ok(!stored.includes("Revised body"));
});

test("immediate and empty recalls produce final receipts; diagnostics and reads do not mark delivery", t => {
  const db = fixture(t);
  const result = recallForDelivery(db, { query: "Cobalt north" });
  assert.equal(readRecallReceipt(db, result.receipt.receipt_id).status, "delivered");
  const count = getMemory(db, "north").recall_count;
  readRecallReceipt(db, result.receipt.receipt_id);
  assert.equal(getMemory(db, "north").recall_count, count);
  const empty = recallForDelivery(db, { query: "Cobalt", recallControl: { mode: "no_recall" } });
  assert.equal(empty.receipt.status, "empty");
  assert.deepEqual(readRecallReceipt(db, empty.receipt.receipt_id).items, []);
  const pruned = pruneRecallDeliveries(db, { at: new Date(Date.now() + 91 * 86400000), apply: true });
  assert.equal(pruned.removed, 2);
});

test("privacy audit records matching blocked titles without enumerating unrelated sealed memories", t => {
  const db = fixture(t);
  for (const [id, title] of [["sealed", "Cobalt private agreement"], ["unrelated", "Distant orchid pledge"]]) {
    writeMemory(db, { id, title, content: `${title} secret body.`, sensitivity: "intimate",
      scope: "private_relationship", egress_policy: "local_only", triggers: [title] });
  }
  const result = recallForDelivery(db, { query: "Cobalt private agreement", context: "general" });
  const receipt = readRecallReceipt(db, result.receipt.receipt_id);
  assert.ok(receipt.items.some(item => item.memory_id === "sealed" && item.result === "privacy_blocked"));
  assert.ok(!receipt.items.some(item => item.memory_id === "unrelated"));
  assert.ok(!JSON.stringify(result.memories).includes("secret body"));
});

test("legacy receipts retain acknowledgement compatibility and minimal readable details", t => {
  const db = fixture(t);
  const memory = getMemory(db, "north");
  db.prepare("INSERT INTO recall_deliveries(id, selected_json, created_at) VALUES (?, ?, ?)")
    .run("delivery:legacy", JSON.stringify([{ id: memory.id, hash: memory.content_hash, lane: "main" }]), new Date().toISOString());
  db.exec("ALTER TABLE recall_deliveries DROP COLUMN details_json");
  ensureRecallCooldown(db);
  acknowledgeRecallDelivery(db, { receiptId: "delivery:legacy", memoryIds: [memory.id] });
  assert.equal(readRecallReceipt(db, "delivery:legacy").items[0].result, "delivered");
  assert.equal(readRecallReceipt(db, "missing"), null);
});

test("limited recall records discarded titles and the actual packing reason", t => {
  const db = fixture(t);
  const result = recallForDelivery(db, { query: "Cobalt route", limit: 1, familyPolicy: "allow-distinct" });
  const receipt = readRecallReceipt(db, result.receipt.receipt_id);
  const omitted = receipt.items.filter(item => item.result === "filtered");
  assert.equal(omitted.length, 1);
  assert.equal(omitted[0].reason, "skipped_limit");
  assert.match(omitted[0].title, /Cobalt/);
});

test("receipt reports background packing omissions rather than admission reasons", t => {
  const db = fixture(t);
  const background = selectBackground([{ entry: { memory: getMemory(db, "north") },
    presentation: { id: "north", title: "Cobalt north", content_hash: getMemory(db, "north").content_hash } }], { maxItems: 0 });
  const details = buildReceiptDetails(db, { memories: [], trace: { candidates: [{ id: "north",
    candidate_generated: true, reason: "non-intimate", ...background.decisions.get("north") }] } },
  { query: "Cobalt", latencyMs: 1 });
  assert.equal(details.items[0].reason, "background-budget");
});

test("permanent deletion clears receipt titles and maintenance removes expired receipts", async t => {
  const db = fixture(t);
  const recalled = recallForDelivery(db, { query: "Cobalt route", deliveryMode: "confirmed" });
  const memory = getMemory(db, "north");
  await deleteMemory(db, { memory_id: memory.id, expected_content_hash: memory.content_hash,
    expected_updated_at: memory.updated_at, confirmation: true, user_instruction: "Delete the north memory permanently." });
  assert.equal(readRecallReceipt(db, recalled.receipt.receipt_id).items.find(item => item.memory_id === memory.id).title, null);
  db.prepare("UPDATE recall_deliveries SET created_at = ?").run("2020-01-01T00:00:00.000Z");
  const stop = startMaintenance(db);
  await stop();
  assert.equal(readRecallReceipt(db, recalled.receipt.receipt_id), null);
});
