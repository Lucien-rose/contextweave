import { bumpPortraitRevision } from "./store.js";

// Called inside canonical deletion's transaction; immutable original conversation
// evidence is not erased by deleting a derived memory record.
export function purgeMemoryPortraitDerivatives(db, memoryId) {
  const items = db.prepare("SELECT subject_id, item_id FROM portrait_evidence WHERE source_type='memory' AND source_id=?").all(memoryId);
  const ids = new Set([memoryId, ...items.map((item) => item.item_id)]);
  const now = new Date().toISOString();
  for (const item of items) {
    db.prepare(`UPDATE portrait_items SET status='purged', title='', content='', content_hash='', details_json='{}',
      revision=revision+1, updated_at=? WHERE subject_id=? AND id=?`).run(now, item.subject_id, item.item_id);
    db.prepare("DELETE FROM portrait_evidence WHERE subject_id=? AND item_id=?").run(item.subject_id, item.item_id);
  }
  for (const subject of new Set(items.map((item) => item.subject_id))) bumpPortraitRevision(db, subject);
  for (const job of db.prepare("SELECT id, input_json, snapshot_json, proposals_json FROM portrait_jobs").all()) {
    if (![job.input_json, job.snapshot_json, job.proposals_json].some((value) => references(JSON.parse(value || "null"), ids))) continue;
    db.prepare(`UPDATE portrait_jobs SET status='cancelled', input_json='{}', snapshot_json=NULL, proposals_json=NULL,
      result_json=NULL, lease_token=NULL, lease_until=NULL, error_code='source-deleted', updated_at=? WHERE id=?`).run(now, job.id);
  }
  for (const row of db.prepare("SELECT event_id, payload_json FROM portrait_observations").all()) {
    if (references(JSON.parse(row.payload_json), ids)) db.prepare("UPDATE portrait_observations SET status='cancelled', payload_json='{}' WHERE event_id=?").run(row.event_id);
  }
  for (const row of db.prepare("SELECT id, payload_json FROM portrait_candidates").all()) {
    if (references(JSON.parse(row.payload_json), ids)) db.prepare("UPDATE portrait_candidates SET status='dismissed', payload_json='{}', reason='source-deleted', updated_at=? WHERE id=?").run(now, row.id);
  }
}

function references(value, ids) {
  if (typeof value === "string") return ids.has(value);
  if (Array.isArray(value)) return value.some((entry) => references(entry, ids));
  return value && typeof value === "object" && Object.values(value).some((entry) => references(entry, ids));
}
