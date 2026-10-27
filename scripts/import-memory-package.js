#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import { resolveImportPath } from "./import-path.js";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { openDatabase, resolveDatabasePath } from "../server/src/database.js";
import { applyMemoryPackage, previewMemoryPackage } from "../server/src/memory-package.js";

const MAX_BYTES = 20 * 1024 * 1024;
const HELP = `Usage: node scripts/import-memory-package.js [FILE.json] [--db DATABASE] [--dry-run | --apply] [--skip-problems]

Paths may be absolute, relative, file: URLs, or relative to MOSS_IMPORT_DIR.
Without FILE, exactly one JSON file must exist in the working/import directories.

Default is read-only dry-run. --apply inserts only new records in one SQLite transaction.
Existing memories are never overwritten. --skip-problems explicitly skips conflicts/invalid entries.
This is a memory import, NOT a full database restore. Stop the backend before --apply.`;

export function parseArgs(argv) {
  const args = { file: null, dbPath: null, apply: false, skipProblems: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--help" || item === "-h") return { help: true };
    if (item === "--apply") args.apply = true;
    else if (item === "--dry-run") args.apply = false;
    else if (item === "--skip-problems") args.skipProblems = true;
    else if (item === "--db") {
      if (!argv[i + 1]) throw new TypeError("--db requires a path");
      args.dbPath = argv[++i];
    } else if (!item.startsWith("-") && !args.file) args.file = item;
    else throw new TypeError(`Unknown argument: ${item}`);
  }
  if (args.skipProblems && !args.apply) throw new TypeError("--skip-problems requires --apply");
  return args;
}

export function importFile({ file, dbPath, apply = false, skipProblems = false }) {
  const path = resolveImportPath(file);
  if (statSync(path).size > MAX_BYTES) throw new TypeError("Package exceeds 20 MiB limit");
  const packageJson = JSON.parse(readFileSync(path, "utf8"));
  const target = resolveDatabasePath(dbPath);
  const connection = apply ? openDatabase(target).db : new DatabaseSync(target, { readOnly: true });
  try {
    const result = apply ? applyMemoryPackage(connection, packageJson, { skipProblems })
      : previewMemoryPackage(connection, packageJson);
    const { rows, ...report } = result;
    return { ...report, file: path, database: target };
  } finally {
    connection.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) console.log(HELP);
    else console.log(JSON.stringify(importFile(args), null, 2));
  } catch (error) {
    console.error(`Memory import failed: ${error.message}`);
    process.exitCode = 1;
  }
}
