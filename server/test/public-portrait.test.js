import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ensurePortraitSchema } from "../src/portrait/schema.js";
import { createPortraitCore } from "../src/portrait/core.js";
import { observePortrait } from "../src/portrait/queue.js";
import { runPortraitWorker } from "../src/portrait/worker.js";

test("public portrait core works with synthetic evidence and no private host dependencies", () => {
  const db = new DatabaseSync(":memory:");
  try {
    ensurePortraitSchema(db);
    const core = createPortraitCore(db);
    const change = { change_id: "demo:1", item_id: "style", expected_revision: 0, operation: "upsert",
      data: { domain: "cognitive", time_scale: "stable", title: "Learning style",
        content: "Prefer examples.", seed_eligible: true },
      source_refs: [{ source_type: "conversation", source_id: "demo-message:1" }] };
    assert.equal(core.update(change).status, "applied");
    assert.equal(core.update(change).duplicate, true);
    assert.equal(core.read({ context: "private", domains: ["cognitive"] }).items.length, 1);
    assert.equal(core.read({ context: "general" }).items.length, 0);
    assert.equal(core.seed({ context: "private" }).content, "Learning style：Prefer examples.");
  } finally { db.close(); }
});

test("exported background runtime processes synthetic observations without private application imports", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    ensurePortraitSchema(db);
    const message = { event_id: "synthetic:1", session_id: "synthetic", text: "A temporary condition was reported.",
      occurred_at: new Date().toISOString(), source_refs: [{ source_type: "conversation", source_id: "synthetic:1" }] };
    observePortrait(db, message);
    const result = await runPortraitWorker(db, { force: true, writer: async () => ({ memory_candidates: [], portrait_changes: [{
      item_id: null, expected_revision: 0, operation: "upsert", risk: "clear",
      data: { domain: "body", time_scale: "living", title: "Temporary condition", content: message.text,
        expires_at: new Date(Date.now() + 86400000).toISOString() },
      evidence: [{ event_id: message.event_id, quote: message.text }],
    }] }) });
    assert.equal(result.status, "done");
    assert.equal(createPortraitCore(db).read({ context: "private" }).items.length, 1);
  } finally { db.close(); }
});
