import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "server", "src");
const DEFAULT_FILE_LIMIT = 600;
const FILE_LIMITS = new Map([
  // Keep the recall pipeline within its existing budget; other modules use
  // the standard limit after the database and reading responsibilities split.
  ["server/src/recall/pipeline.js", 510],
]);
const DEFAULT_FUNCTION_LIMIT = 150;
const DUPLICATE_BODY_MIN_CHARS = 100;

const packageVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const sourceFiles = walk(SRC).filter((file) => extname(file) === ".js");
const failures = [];
const warnings = [];

checkFileSizes();
checkFunctionSizes();
checkImportCycles();
checkVersionAuthority();
checkDuplicateFunctions();

if (warnings.length) {
  console.log("Architecture warnings:");
  for (const warning of warnings) console.log(`  WARN ${warning}`);
}
if (failures.length) {
  console.error("Architecture check failed:");
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Architecture check passed: ${sourceFiles.length} source files, 0 cycles, version authority clean.`);
}

function checkFileSizes() {
  for (const file of sourceFiles) {
    const rel = relPath(file);
    const lines = lineCount(readFileSync(file, "utf8"));
    const limit = FILE_LIMITS.get(rel) ?? DEFAULT_FILE_LIMIT;
    if (lines > limit) failures.push(`${rel} has ${lines} lines (limit ${limit})`);
  }
}

function checkFunctionSizes() {
  for (const file of sourceFiles) {
    const rel = relPath(file);
    const text = readFileSync(file, "utf8");
    for (const fn of functionsIn(text)) {
      const limit = functionLimit(rel, fn.name);
      if (fn.lines > limit) failures.push(`${rel}:${fn.line} ${fn.name} has ${fn.lines} lines (limit ${limit})`);
    }
  }
}

function functionLimit(rel, name) {
  if (rel.endsWith("schema.js") && name.startsWith("ensure")) return 500;
  if (rel.startsWith("server/src/mcp/") && /^register.+Tools$/.test(name)) return 320;
  return DEFAULT_FUNCTION_LIMIT;
}

function checkImportCycles() {
  const graph = new Map(sourceFiles.map((file) => [file, []]));
  for (const file of sourceFiles) {
    const text = readFileSync(file, "utf8");
    const specs = [...text.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.[^"']+)["']/g)].map((match) => match[1]);
    for (const spec of specs) {
      const target = resolveImport(file, spec);
      if (target && graph.has(target)) graph.get(file).push(target);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  for (const file of sourceFiles) visit(file);

  function visit(file) {
    if (visited.has(file)) return;
    if (visiting.has(file)) {
      const start = stack.indexOf(file);
      const cycle = [...stack.slice(start), file].map(relPath).join(" -> ");
      failures.push(`import cycle: ${cycle}`);
      return;
    }
    visiting.add(file);
    stack.push(file);
    for (const next of graph.get(file) || []) visit(next);
    stack.pop();
    visiting.delete(file);
    visited.add(file);
  }
}

function checkVersionAuthority() {
  const targets = [...sourceFiles, ...walk(join(ROOT, "scripts")).filter((file) => extname(file) === ".js")];
  for (const file of targets) {
    if (relPath(file) === "server/src/version.js") continue;
    const text = readFileSync(file, "utf8");
    if (text.includes(packageVersion)) failures.push(`${relPath(file)} hardcodes current package version; import VERSION instead`);
  }
}

function checkDuplicateFunctions() {
  const groups = new Map();
  for (const file of sourceFiles) {
    const rel = relPath(file);
    const text = readFileSync(file, "utf8");
    for (const fn of functionsIn(text)) {
      const normalized = fn.body.replace(/\s+/g, " ").trim();
      if (normalized.length < DUPLICATE_BODY_MIN_CHARS) continue;
      const list = groups.get(normalized) || [];
      list.push(`${rel}:${fn.name}`);
      groups.set(normalized, list);
    }
  }
  for (const refs of groups.values()) {
    if (refs.length < 2) continue;
    for (let i = 0; i < refs.length; i += 1) {
      for (let j = i + 1; j < refs.length; j += 1) {
        failures.push(`duplicate function bodies: ${refs[i]} and ${refs[j]}`);
      }
    }
  }
}

function functionsIn(text) {
  const results = [];
  const pattern = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/gm;
  for (const match of text.matchAll(pattern)) {
    const brace = text.indexOf("{", match.index);
    const end = matchingBrace(text, brace);
    if (end < 0) continue;
    results.push({
      name: match[1],
      line: lineCount(text.slice(0, match.index)),
      lines: lineCount(text.slice(match.index, end + 1)),
      body: text.slice(brace + 1, end),
    });
  }
  return results;
}

function matchingBrace(text, start) {
  let depth = 0;
  let mode = "code";
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (mode === "line-comment") {
      if (char === "\n") mode = "code";
      continue;
    }
    if (mode === "block-comment") {
      if (char === "*" && next === "/") { mode = "code"; index += 1; }
      continue;
    }
    if (mode !== "code") {
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if ((mode === "single" && char === "'") || (mode === "double" && char === '"') || (mode === "template" && char === "`")) mode = "code";
      continue;
    }
    if (char === "/" && next === "/") { mode = "line-comment"; index += 1; continue; }
    if (char === "/" && next === "*") { mode = "block-comment"; index += 1; continue; }
    if (char === "'") { mode = "single"; continue; }
    if (char === '"') { mode = "double"; continue; }
    if (char === "`") { mode = "template"; continue; }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return index;
  }
  return -1;
}

function resolveImport(file, spec) {
  const base = resolve(dirname(file), spec);
  const candidates = extname(base) ? [base] : [`${base}.js`, join(base, "index.js")];
  return candidates.find((candidate) => sourceFiles.includes(candidate)) || null;
}

function walk(directory) {
  if (!statSafe(directory)?.isDirectory()) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    const stat = statSafe(path);
    return stat?.isDirectory() ? walk(path) : (stat?.isFile() ? [path] : []);
  });
}

function statSafe(path) {
  try { return statSync(path); } catch { return null; }
}

function lineCount(text) {
  if (!text) return 0;
  return text.split("\n").length;
}

function relPath(file) {
  return relative(ROOT, file).replaceAll("\\", "/");
}
