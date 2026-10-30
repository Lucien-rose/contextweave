import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { fileURLToPath } from "node:url";

test("ESM and CommonJS consumers resolve packaged types and narrow domain states", () => {
  const files = ["consumer.mts", "consumer.cts"].map(name => fileURLToPath(new URL(name, import.meta.url)));
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, noEmit: true, types: [],
  });
  const errors = ts.getPreEmitDiagnostics(program);
  assert.equal(errors.length, 0, ts.formatDiagnostics(errors, {
    getCurrentDirectory: () => process.cwd(), getCanonicalFileName: name => name, getNewLine: () => "\n",
  }));
});
