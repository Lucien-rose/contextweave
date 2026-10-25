import { resolve } from "node:path";

export function databaseFileFor(db) {
  const main = db.prepare("PRAGMA database_list").all().find((row) => row.name === "main");
  return resolve(main?.file || "data/moss-memory.sqlite");
}

export function ensureSqliteColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
