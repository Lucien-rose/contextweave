import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { createBackend } from "../src/backend.js";
import { importFile } from "../../scripts/import-memory-package.js";
import { resolveImportPath } from "../../scripts/import-path.js";
import { diagnose } from "../../scripts/doctor.js";
import { runExample } from "../../examples/host/run.js";

test("import discovery resolves mounted filenames and refuses ambiguous choices", () => {
  const directory = mkdtempSync(join(tmpdir(), "cw-path-"));
  try {
    const mount = join(directory, "imports");
    mkdirSync(mount);
    const file = join(mount, "memories.json");
    writeFileSync(file, "{}");
    const options = { cwd: directory, importDir: mount };
    assert.equal(resolveImportPath("memories.json", options), file);
    assert.equal(resolveImportPath(null, options), file);
    assert.equal(resolveImportPath(file, options), file);
    writeFileSync(join(mount, "other.json"), "{}");
    assert.throws(() => resolveImportPath(null, options), /Multiple import files/);
    assert.throws(() => resolveImportPath("missing.json", options), /No import file/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("deployment doctor and host example exercise a real HTTP backend with separate tokens", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cw-deploy-"));
  const previous = process.env.MOSS_CONFIG_DIR;
  process.env.MOSS_CONFIG_DIR = directory;
  writeFileSync(join(directory, "models.key"), randomBytes(32).toString("hex"));
  const dbPath = join(directory, "memory.sqlite");
  const adminToken = "synthetic-admin-token-deployment";
  const runtimeToken = "synthetic-runtime-token-deployment";
  const backend = createBackend({ databasePath: dbPath, adminToken, runtimeToken });
  const server = backend.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const file = new URL("../../examples/host/memories.json", import.meta.url).href;
    assert.equal(importFile({ file, dbPath }).new, 1);
    assert.equal(importFile({ file, dbPath, apply: true }).imported, 1);
    assert.equal(importFile({ file, dbPath, apply: true }).imported, 0);
    const report = await diagnose({ dbPath, baseUrl, adminToken, runtimeToken });
    assert.equal(report.ok, true, JSON.stringify(report));
    const example = await runExample({ baseUrl, token: runtimeToken });
    assert.ok(backend.db.prepare("SELECT id FROM memories WHERE id=? AND status='active'").get(example.created));
    const failed = await diagnose({ dbPath, baseUrl, adminToken: runtimeToken, runtimeToken });
    assert.equal(failed.ok, false);
    assert.equal(failed.checks.find(check => check.name === "mcp-admin").status, "fail");
    assert.ok(!JSON.stringify(failed).includes(runtimeToken));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await backend.close();
    if (previous === undefined) delete process.env.MOSS_CONFIG_DIR;
    else process.env.MOSS_CONFIG_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
