import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, writeMemory, getMemory } from "../src/database.js";
import { previewMemoryPackage, applyMemoryPackage } from "../src/memory-package.js";
import { importFile } from "../../scripts/import-memory-package.js";

function fixture(fn) {
  const directory = mkdtempSync(join(tmpdir(), "cw-import-"));
  const path = join(directory, "memory.sqlite");
  const { db } = openDatabase(path);
  try { return fn({ db, path, directory }); }
  finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
}

test("memory package dry-run is read-only, apply is idempotent and preserves evidence excerpts", () => fixture(({ db }) => {
  const pkg = { format: "contextweave-memory-package", version: 1, memories: [{
    id: "import:test", title: "Favorite tea", content: "Prefers jasmine tea.", kind: "preference",
    importance: 72, sensitivity: "private", tags: ["tea"],
    source_refs: [{ source_type: "conversation", source_id: "message:1", excerpt: "I like jasmine tea." }],
  }] };
  const before = db.prepare("SELECT COUNT(*) AS n FROM memories").get().n;
  const plan = previewMemoryPackage(db, pkg);
  assert.equal(plan.new, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memories").get().n, before);
  const applied = applyMemoryPackage(db, pkg);
  assert.equal(applied.imported, 1);
  const memory = getMemory(db, "import:test");
  assert.equal(memory.content, "Prefers jasmine tea.");
  assert.equal(memory.evidence[0].excerpt, "I like jasmine tea.");
  assert.equal(memory.layer, "context");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM family_change_receipts WHERE change_id='import:import:test'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memory_vector_jobs WHERE memory_id='import:test'").get().n, 1);
  assert.equal(applyMemoryPackage(db, pkg).imported, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memories").get().n, before + 1);
}));

test("conflicts and invalid records block writes atomically unless explicitly skipped", () => fixture(({ db }) => {
  writeMemory(db, { id: "same:id", title: "Existing", content: "Original." });
  const pkg = { memories: [
    { id: "new:id", title: "New", content: "New memory." },
    { id: "same:id", title: "Different", content: "Changed content." },
    { id: "bad:id", title: "Bad", content: "Invalid status.", status: "superseded" },
  ] };
  const plan = previewMemoryPackage(db, pkg);
  assert.equal(plan.new, 1);
  assert.equal(plan.conflicts, 1);
  assert.equal(plan.invalid, 1);
  assert.throws(() => applyMemoryPackage(db, pkg), /Import blocked/);
  assert.equal(getMemory(db, "new:id"), null);
  const result = applyMemoryPackage(db, pkg, { skipProblems: true });
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 2);
  assert.equal(getMemory(db, "same:id").content, "Original.");
  assert.equal(getMemory(db, "new:id").content, "New memory.");
}));

test("content duplicates and within-package ID collisions are distinguished", () => fixture(({ db }) => {
  const pkg = { memories: [
    { title: "A", content: "Repeated." },
    { title: "A", content: "Repeated." },
    { id: "collision", title: "First", content: "One." },
    { id: "collision", title: "Second", content: "Two." },
  ] };
  const plan = previewMemoryPackage(db, pkg);
  assert.equal(plan.new, 2);
  assert.equal(plan.duplicates, 1);
  assert.equal(plan.conflicts, 1);
}));

test("owner exports are explicitly partial imports and CLI previews before apply", () => fixture(({ db, path, directory }) => {
  const file = join(directory, "package.json");
  writeFileSync(file, JSON.stringify({
    memories: [{ content: "A portable memory." }],
    memory_state: { tables: { portrait_items: [{ id: "not-imported" }] } },
  }));
  const preview = importFile({ file, dbPath: path });
  assert.equal(preview.new, 1);
  assert.match(preview.warnings[0], /not restore Lineage receipts/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memories").get().n, 0);
  const applied = importFile({ file, dbPath: path, apply: true });
  assert.equal(applied.imported, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM memories").get().n, 1);
}));

test("same ID with different sensitivity or new evidence is a conflict, not a silent duplicate", () => fixture(({ db }) => {
  const original = { memories: [{ id: "privacy:test", title: "Note", content: "A note.", sensitivity: "private" }] };
  applyMemoryPackage(db, original);
  const changed = { memories: [{ id: "privacy:test", title: "Note", content: "A note.", sensitivity: "personal" }] };
  assert.equal(previewMemoryPackage(db, changed).conflicts, 1);
  const evidence = { memories: [{ ...original.memories[0],
    source_refs: [{ source_type: "conversation", source_id: "new:message", excerpt: "A note." }] }] };
  assert.equal(previewMemoryPackage(db, evidence).conflicts, 1);
}));

test("invalid calendar dates are rejected during preview", () => fixture(({ db }) => {
  const plan = previewMemoryPackage(db, { memories: [{ content: "Calendar", event_date: "2026-02-31" }] });
  assert.equal(plan.invalid, 1);
  assert.equal(plan.new, 0);
}));
