import { openDatabase } from "../server/src/database.js";

export function openVectorDatabase() {
  const { db, dbPath } = openDatabase(process.env.MOSS_DB_PATH);
  return { db, dbPath };
}

export function numberArg(argv, name, fallback, { min = 1, max = 1_000_000 } = {}) {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number.parseInt(argv[index + 1], 10);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function hasFlag(argv, name) {
  return argv.includes(name);
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
