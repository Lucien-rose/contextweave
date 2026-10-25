import { publicError } from "../lib/error.js";

export function ensureRecallSettings(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS recall_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1), intimacy_mode TEXT NOT NULL DEFAULT 'model'
  ); INSERT OR IGNORE INTO recall_settings(id) VALUES (1);`);
}

export function readRecallSettings(db) {
  return db.prepare("SELECT intimacy_mode FROM recall_settings WHERE id = 1").get();
}

export function saveRecallSettings(db, { intimacy_mode }) {
  if (!["on", "off", "model"].includes(intimacy_mode)) throw publicError("Invalid intimacy mode");
  db.prepare("UPDATE recall_settings SET intimacy_mode = ? WHERE id = 1").run(intimacy_mode);
  return readRecallSettings(db);
}

export function withRecallSettings(db, input = {}) {
  const mode = readRecallSettings(db).intimacy_mode;
  return { ...input, intimacyMode: mode === "model" ? (input.intimacyMode || "model") : mode };
}
