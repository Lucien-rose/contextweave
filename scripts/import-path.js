import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveImportPath(input, { cwd = process.cwd(), importDir = process.env.MOSS_IMPORT_DIR } = {}) {
  if (input?.startsWith("file:")) return fileURLToPath(input);
  if (input && isAbsolute(input)) return input;
  const roots = [...new Set([cwd, importDir].filter(Boolean).map(path => resolve(path)))];
  const candidates = input ? roots.map(root => resolve(root, input)).filter(existsSync)
    : roots.flatMap(root => existsSync(root) ? readdirSync(root)
      .filter(name => name.endsWith(".json") && !["package.json", "package-lock.json"].includes(name))
      .map(name => join(root, name)).filter(path => statSync(path).isFile()) : []);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) throw new TypeError(`Multiple import files found; specify an absolute path: ${candidates.join(", ")}`);
  throw new TypeError(`No import file found. Specify FILE.json or place one JSON file in ${importDir || cwd}.`);
}
