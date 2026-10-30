import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
const root = process.cwd();
const excluded = new Set(["node_modules", ".git", "__pycache__", ".mypy_cache"]);
const forbiddenPaths = /^(private|skills|data|imports|server\/public)(\/|$)|\.(sqlite|db|log)(-|$)|^\.env$/;
const forbidden = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /sk-[A-Za-z0-9_-]{20,}/];
let count = 0;
function walk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (excluded.has(item.name) || item.name.endsWith(".egg-info")) continue;
    const path = join(dir, item.name), rel = relative(root, path).replaceAll("\\", "/");
    if (forbiddenPaths.test(rel)) throw new Error(`Private path in release: ${rel}`);
    if (item.isDirectory()) { walk(path); continue; }
    if (rel === "scripts/check-public.js") continue;
    const text = readFileSync(path, "utf8");
    if (text.startsWith("SQLite format 3")) throw new Error(`Database in release: ${rel}`);
    if (forbidden.some(pattern => pattern.test(text))) throw new Error(`Possible credential in ${rel}`);
    count++;
  }
}
walk(root);
console.log(`Release boundary checked: ${count} files. Review deployment-specific identifiers separately.`);
