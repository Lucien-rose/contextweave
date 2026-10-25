#!/usr/bin/env node
import { copyFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export function verifyDatabase(path) {
  const db = new DatabaseSync(resolve(path), { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").all();
    if (integrity.some(row => Object.values(row)[0] !== "ok") || db.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("Database integrity or foreign-key check failed");
    }
    return { tables: db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get().count };
  } finally { db.close(); }
}

export function backupDatabase(source, destination) {
  source = resolve(source); destination = resolve(destination);
  if (!existsSync(source)) throw new Error("Source database does not exist");
  if (existsSync(destination)) throw new Error("Destination already exists; use a new backup path");
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(source, { readOnly: true });
  try { db.prepare("VACUUM INTO ?").run(destination); }
  finally { db.close(); }
  chmodSync(destination, 0o600);
  return verifyDatabase(destination);
}

export function restoreDatabase(source, destination) {
  verifyDatabase(source);
  destination = resolve(destination);
  if ([destination, `${destination}-wal`, `${destination}-shm`].some(existsSync)) {
    throw new Error("Restore requires a new path; stop the service and retain the old database before cutover");
  }
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
  return verifyDatabase(destination);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [operation, source, destination] = process.argv.slice(2);
  if (!["backup", "restore", "verify"].includes(operation) || !source || (operation !== "verify" && !destination)) {
    throw new Error("Usage: node scripts/database-backup.js backup|restore SOURCE DESTINATION, or verify DATABASE");
  }
  const result = operation === "backup" ? backupDatabase(source, destination)
    : operation === "restore" ? restoreDatabase(source, destination) : verifyDatabase(source);
  console.log(JSON.stringify({ operation, ok: true, ...result }));
}
