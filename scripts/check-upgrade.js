import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase, getMemory } from "../server/src/database.js";
import { backupDatabase, restoreDatabase, verifyDatabase } from "./database-backup.js";
import { createMemoryCore } from "../server/src/memory-core.js";

if (!process.argv[2]) throw new Error("Usage: node scripts/check-upgrade.js /path/to/previous-release");
const previousRoot = resolve(process.argv[2]);
const previous = await import(pathToFileURL(join(previousRoot, "server/src/database.js")));
const directory = mkdtempSync(join(tmpdir(), "moss-upgrade-"));
const dbPath = join(directory, "upgrade.sqlite");
const schema = (db) => db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
let db;
try {
  db = previous.openDatabase(dbPath).db;
  previous.writeMemory(db, { id: "upgrade:decision", title: "Cobalt release decision",
    content: "Use staged deployment and keep the original source excerpt.",
    recall_summary: "Staged Cobalt deployment.", kind: "episode", family_key: "upgrade:cobalt" });
  const before = previous.getMemory(db, "upgrade:decision");
  const beforeSchema = schema(db);
  const beforeJobs = db.prepare("SELECT * FROM memory_vector_jobs ORDER BY memory_id").all();
  db.close();
  db = openDatabase(dbPath).db;
  assert.deepEqual(getMemory(db, before.id), before);
  const afterSchema = schema(db);
  const originalNames = new Set(beforeSchema.map(row => row.name));
  assert.deepEqual(afterSchema.filter(row => originalNames.has(row.name)), beforeSchema);
  verifyDatabase(dbPath);
  backupDatabase(dbPath, join(directory, "backup.sqlite"));
  restoreDatabase(join(directory, "backup.sqlite"), join(directory, "restored.sqlite"));
  const restored = openDatabase(join(directory, "restored.sqlite")).db;
  assert.deepEqual(getMemory(restored, before.id), before);
  assert.deepEqual(schema(restored), afterSchema);
  restored.close();
  assert.deepEqual(db.prepare("SELECT * FROM memory_vector_jobs ORDER BY memory_id").all(), beforeJobs);
  const result = createMemoryCore(db).recallWithTrace({ query: before.title, context: "private",
    intimacyMode: "off", shadowMode: "off", recordRecall: false });
  assert.equal(result.memories[0].id, before.id);
  assert.deepEqual(getMemory(db, before.id), before);
  db.close();
  db = previous.openDatabase(dbPath).db;
  assert.deepEqual(previous.getMemory(db, before.id), before);
  console.log("UPGRADE_OK canonical record, original schema, full schema, snapshot restore, pending vector jobs, recall and previous-release reopen");
} finally {
  db?.close();
  rmSync(directory, { recursive: true, force: true });
}
