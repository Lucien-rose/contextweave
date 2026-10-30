import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

test("packed SDK installs independently with ESM and CommonJS exports and no backend files", t => {
  const directory = mkdtempSync(join(tmpdir(), "contextweave-sdk-package-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = fileURLToPath(new URL("../", import.meta.url));
  const [packed] = JSON.parse(execFileSync("npm", ["pack", root, "--pack-destination", directory, "--json"], { encoding: "utf8" }));
  assert.ok(packed.files.some(file => file.path === "dist/index.d.ts"));
  assert.ok(packed.files.some(file => file.path === "LICENSE"));
  assert.ok(packed.files.every(file => /^(dist\/|README.md$|LICENSE$|package.json$)/.test(file.path)));
  execFileSync("npm", ["install", "--prefix", directory, "--ignore-scripts", "--no-audit", "--no-fund", join(directory, packed.filename)], { stdio: "pipe" });
  for (const [mode, source] of [
    ["module", 'import { ContextWeave } from "@contextweave/sdk"; console.log(typeof ContextWeave)'],
    ["commonjs", 'const { ContextWeave } = require("@contextweave/sdk"); console.log(typeof ContextWeave)'],
  ]) {
    assert.equal(execFileSync(process.execPath, [`--input-type=${mode}`, "-e", source], { cwd: directory, encoding: "utf8" }).trim(), "function");
  }
});
