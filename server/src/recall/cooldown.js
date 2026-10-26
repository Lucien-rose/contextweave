import { parseContract } from "../lib/contract.js";
import { z } from "zod/v4";
import { ensureSqliteColumn } from "../lib/sqlite.js";

export const recallScopeSchema = z.object({
  client: z.string().min(1).max(120), surface: z.string().min(1).max(120),
  session: z.string().max(240).optional(), cooldown_hours: z.number().min(0).max(168).default(24),
}).strict();

export function ensureRecallCooldown(db) {
  ensureSqliteColumn(db, "recall_deliveries", "scope_json", "TEXT");
  db.exec(`CREATE TABLE IF NOT EXISTS recall_surface_deliveries (
    client TEXT NOT NULL, surface TEXT NOT NULL, memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL, session TEXT, delivered_at TEXT NOT NULL,
    PRIMARY KEY(client, surface, memory_id, content_hash)
  ); CREATE INDEX IF NOT EXISTS idx_recall_surface_time ON recall_surface_deliveries(delivered_at);`);
}

export function scopedRecallInput(db, input) {
  if (!input.recallScope) return input;
  const scope = parseContract(recallScopeSchema, input.recallScope);
  const cutoff = new Date(Date.now() - scope.cooldown_hours * 3600000).toISOString();
  const rows = scope.cooldown_hours ? db.prepare(`SELECT d.memory_id, d.content_hash FROM recall_surface_deliveries d
    JOIN memories m ON m.id = d.memory_id AND m.content_hash = d.content_hash
    WHERE d.client = ? AND d.surface = ? AND d.delivered_at > ?`).all(scope.client, scope.surface, cutoff) : [];
  return { ...input, recallScope: scope, cooledMemoryHashes: new Map(rows.map(row => [row.memory_id, row.content_hash])) };
}

export function recordSurfaceDelivery(db, scope, items, deliveredAt) {
  if (!scope) return;
  db.prepare("DELETE FROM recall_surface_deliveries WHERE delivered_at < ?")
    .run(new Date(Date.parse(deliveredAt) - 30 * 86400000).toISOString());
  const insert = db.prepare(`INSERT INTO recall_surface_deliveries VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(client, surface, memory_id, content_hash) DO UPDATE SET
      session = excluded.session, delivered_at = excluded.delivered_at`);
  for (const item of items) if (item.lane === "main") {
    insert.run(scope.client, scope.surface, item.id, item.hash, scope.session || null, deliveredAt);
  }
}
