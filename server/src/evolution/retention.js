const DAY = 86_400_000;

export const EVOLUTION_RETENTION = Object.freeze({
  change_receipt_days: 60,
  resolved_review_days: 14,
  deletion_tombstone_days: 90,
});

export function evolutionHousekeeping(db, at = new Date()) {
  const changeCutoff = before(at, EVOLUTION_RETENTION.change_receipt_days);
  const reviewCutoff = before(at, EVOLUTION_RETENTION.resolved_review_days);
  const tombstoneCutoff = before(at, EVOLUTION_RETENTION.deletion_tombstone_days);
  return {
    changes_deleted: db.prepare("DELETE FROM memory_changes WHERE created_at <= ?").run(changeCutoff).changes,
    reviews_deleted: db.prepare(`
      DELETE FROM memory_reviews
      WHERE status IN ('resolved', 'dismissed') AND resolved_at <= ?
    `).run(reviewCutoff).changes,
    tombstones_deleted: db.prepare(`
      DELETE FROM memory_deletions
      WHERE vector_pending = 0 AND deleted_at <= ?
    `).run(tombstoneCutoff).changes,
  };
}

export function evolutionRetentionStatus(db) {
  return {
    rules: EVOLUTION_RETENTION,
    change_receipts: db.prepare("SELECT COUNT(*) AS n FROM memory_changes").get().n,
    pending_reviews: db.prepare("SELECT COUNT(*) AS n FROM memory_reviews WHERE status IN ('pending', 'planned')").get().n,
    resolved_reviews: db.prepare("SELECT COUNT(*) AS n FROM memory_reviews WHERE status IN ('resolved', 'dismissed')").get().n,
    deferred_reviews: db.prepare("SELECT COUNT(*) AS n FROM memory_reviews WHERE status = 'deferred_external'").get().n,
    pending_vector_deletions: db.prepare("SELECT COUNT(*) AS n FROM memory_deletions WHERE vector_pending = 1").get().n,
    completed_tombstones: db.prepare("SELECT COUNT(*) AS n FROM memory_deletions WHERE vector_pending = 0").get().n,
  };
}

function before(at, days) {
  return new Date(at.getTime() - days * DAY).toISOString();
}
