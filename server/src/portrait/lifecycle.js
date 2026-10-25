import { defaults } from "../defaults.js";
import { transaction } from "../lib/transaction.js";
import { bumpPortraitRevision } from "./store.js";

export const EXPIRED_GRACE_DAYS = defaults.expiredGraceDays;

export function portraitHousekeeping(db, { at = new Date() } = {}) {
  const now = at.toISOString();
  const cutoff = new Date(at.getTime() - EXPIRED_GRACE_DAYS * 86400000).toISOString();
  return transaction(db, () => {
    const expired = db.prepare(`SELECT subject_id, id FROM portrait_items WHERE time_scale = 'living'
      AND status IN ('active', 'fading') AND expires_at <= ?`).all(now);
    const purged = db.prepare(`SELECT subject_id, id FROM portrait_items WHERE time_scale = 'living'
      AND status != 'purged' AND expires_at <= ?`).all(cutoff);
    const expire = db.prepare(`UPDATE portrait_items SET status = 'expired', revision = revision + 1,
      updated_at = ? WHERE subject_id = ? AND id = ?`);
    for (const item of expired) expire.run(now, item.subject_id, item.id);
    const purge = db.prepare(`UPDATE portrait_items SET status = 'purged', title = '', content = '',
      content_hash = '', details_json = '{}', revision = revision + 1, updated_at = ? WHERE subject_id = ? AND id = ?`);
    for (const item of purged) {
      purge.run(now, item.subject_id, item.id);
      db.prepare("DELETE FROM portrait_evidence WHERE subject_id = ? AND item_id = ?").run(item.subject_id, item.id);
    }
    for (const subjectId of new Set([...expired, ...purged].map((item) => item.subject_id))) bumpPortraitRevision(db, subjectId);
    return { expired: expired.length, purged: purged.length, expired_grace_days: EXPIRED_GRACE_DAYS };
  });
}
