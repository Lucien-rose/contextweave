import { defaults } from "../defaults.js";
import { z } from "zod/v4";
import { parseContract } from "../lib/contract.js";

export const changeExplanationSchema = z.object({
  changed: z.string().min(1).max(2000),
  reason: z.string().min(1).max(2000).nullable(),
  reason_kind: z.enum(["explicit", "inferred", "unknown"]),
}).strict().superRefine((value, ctx) => {
  if ((value.reason_kind === "unknown") !== (value.reason === null)) {
    ctx.addIssue({ code: "custom", message: "Unknown reason must be null; other reasons require text" });
  }
});

export const familyHistorySchema = z.object({
  family_key: z.string().min(1).max(160),
  change_id: z.string().min(1).max(240).optional(),
  before_sequence: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(50).default(20),
  max_chars: z.number().int().min(12000).max(50000).default(defaults.historyChars).describe("Integer 12000–50000; defaults to the deployment history budget. UTF-16 code units for serialized receipts, not tokens. Omit for normal reads."),
  context: z.enum(["general", "private", "intimate"]).default("private"),
  intimacy_mode: z.enum(["off", "proactive", "scene"]).default("off"),
}).strict();

export function ensureFamilyHistorySchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS family_change_receipts (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, change_id TEXT NOT NULL UNIQUE,
    family_key TEXT NOT NULL, operation TEXT NOT NULL, status TEXT NOT NULL,
    before_ids_json TEXT NOT NULL, after_ids_json TEXT NOT NULL,
    explanation_json TEXT NOT NULL, evidence_json TEXT NOT NULL,
    sensitivity TEXT NOT NULL, created_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_family_receipt_history ON family_change_receipts(family_key, sequence);`);
}

export function recordFamilyChange(db, { changeId, familyKey, operation, before = [], after = [],
  explanation = null, sources = [], at = new Date().toISOString() }) {
  const ranks = ["personal", "private", "sensitive", "intimate"];
  const sensitivity = [...before, ...after].reduce((level, item) =>
    ranks.indexOf(item.sensitivity) > ranks.indexOf(level) ? item.sensitivity : level, "private");
  const detail = explanation || { changed: operation, reason: null, reason_kind: "unknown" };
  const refs = sources.map(({ source_type, source_id, material_id, source_hash, occurred_at }) =>
    ({ source_type, source_id, material_id, source_hash, occurred_at }));
  db.prepare(`INSERT OR IGNORE INTO family_change_receipts
    (change_id, family_key, operation, status, before_ids_json, after_ids_json,
     explanation_json, evidence_json, sensitivity, created_at) VALUES (?, ?, ?, 'applied', ?, ?, ?, ?, ?, ?)`)
    .run(changeId, familyKey, operation, JSON.stringify(before.map(item => item.id)),
      JSON.stringify(after.map(item => item.id)), JSON.stringify(detail), JSON.stringify(refs), sensitivity, at);
}

export function migrateFamilyHistory(db) {
  const rows = db.prepare(`SELECT * FROM memory_changes WHERE status!='deleted'
    AND id NOT IN (SELECT change_id FROM family_change_receipts) ORDER BY created_at, rowid`).all();
  for (const row of rows) {
    const before = JSON.parse(row.before_json || "[]");
    const after = JSON.parse(row.after_json || "[]");
    if (!before.length && !after.length) continue;
    recordFamilyChange(db, { changeId: row.id, familyKey: row.family_key, operation: row.operation,
      before, after: after.filter(item => item.id === row.memory_id), at: row.created_at });
    db.prepare("UPDATE family_change_receipts SET status=? WHERE change_id=?").run(row.status, row.id);
  }
}

export function readFamilyHistory(db, rawInput) {
  const input = parseContract(familyHistorySchema, rawInput);
  if (input.context === "general") return { receipts: [], next_before_sequence: null };
  const rows = db.prepare(`SELECT * FROM family_change_receipts WHERE family_key=?
    AND (? IS NULL OR change_id=?) AND (? IS NULL OR sequence<?)
    AND (sensitivity!='intimate' OR ?=1) ORDER BY sequence DESC LIMIT ?`)
    .all(input.family_key, input.change_id || null, input.change_id || null,
      input.before_sequence || null, input.before_sequence || null,
      Number(input.context === "intimate" || input.intimacy_mode !== "off"), input.limit + 1);
  const candidates = rows.slice(0, input.limit).map(({ before_ids_json, after_ids_json,
    explanation_json, evidence_json, ...row }) => ({ ...row,
    ...JSON.parse(explanation_json), before_ids: JSON.parse(before_ids_json), after_ids: JSON.parse(after_ids_json),
    evidence_refs: JSON.parse(evidence_json),
    expand_via: "moss_read; use existing summary/chunk reads, then moss_source_context for original evidence",
  }));
  const receipts = [];
  for (const candidate of candidates) {
    if (JSON.stringify([...receipts, candidate]).length > input.max_chars - 200) {
      if (!receipts.length) receipts.push({ change_id: candidate.change_id, sequence: candidate.sequence,
        operation: candidate.operation, status: candidate.status, details_omitted: true,
        read_via: { tool: "moss_family_history", arguments: { ...input, change_id: candidate.change_id, max_chars: 50000 } } });
      break;
    }
    receipts.push(candidate);
  }
  return { receipts, next_before_sequence: rows.length > receipts.length ? receipts.at(-1)?.sequence || null : null };
}

export function redactFamilyHistory(db, memoryId) {
  for (const row of db.prepare("SELECT * FROM family_change_receipts").all()) {
    const ids = [...JSON.parse(row.before_ids_json), ...JSON.parse(row.after_ids_json)];
    const refs = JSON.parse(row.evidence_json);
    if (!ids.includes(memoryId) && !refs.some(ref => ref.source_type === "memory" && ref.source_id === memoryId)) continue;
    db.prepare(`UPDATE family_change_receipts SET status='redacted', explanation_json=?, evidence_json='[]' WHERE change_id=?`)
      .run(JSON.stringify({ changed: "Associated memory permanently deleted", reason: null, reason_kind: "unknown" }), row.change_id);
  }
}
