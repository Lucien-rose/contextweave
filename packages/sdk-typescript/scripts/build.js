import ts from "typescript";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const src = join(root, "src"), dist = join(root, "dist");
const files = readdirSync(src).filter(name => name.endsWith(".ts"));
const program = ts.createProgram(files.map(name => join(src, name)), {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true,
  declaration: true, outDir: dist, rootDir: src, types: [],
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root, getCanonicalFileName: path => path, getNewLine: () => "\n",
  }));
  process.exit(1);
}
program.emit();
mkdirSync(join(dist, "cjs"), { recursive: true });
writeFileSync(join(dist, "cjs/package.json"), '{"type":"commonjs"}\n');
for (const name of files) {
  const output = ts.transpileModule(readFileSync(join(src, name), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  writeFileSync(join(dist, "cjs", name.replace(/\.ts$/, ".js")), output.outputText);
  copyFileSync(join(dist, name.replace(/\.ts$/, ".d.ts")), join(dist, "cjs", name.replace(/\.ts$/, ".d.ts")));
}
copyFileSync(join(root, "../../LICENSE"), join(root, "LICENSE"));
