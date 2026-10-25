import { randomUUID } from "node:crypto";
import { publicError } from "../lib/error.js";
import { transaction } from "../lib/transaction.js";
import { deferReviewSchema, parseContract } from "./contract.js";
import { writeDeferredReview } from "./notion-review.js";

const ACTIVE_STATUSES = ["pending", "planned"];

export function queueReview(db, intent, reason, at = new Date()) {
  const reviewId = `review:${randomUUID()}`;
  db.prepare(`
    INSERT INTO memory_reviews(
      family_key, intent_json, reason, updated_at, review_id, status,
      resolved_at, notion_page_id, notion_url, deferred_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL)
    ON CONFLICT(family_key) DO UPDATE SET
      intent_json = excluded.intent_json,
      reason = excluded.reason,
      updated_at = excluded.updated_at,
      review_id = CASE
        WHEN memory_reviews.status IN ('resolved', 'dismissed', 'deferred_external')
          THEN excluded.review_id
        ELSE memory_reviews.review_id
      END,
      status = 'pending',
      resolved_at = NULL,
      notion_page_id = NULL,
      notion_url = NULL,
      deferred_at = NULL
  `).run(intent.family_key, JSON.stringify(intent), reason, at.toISOString(), reviewId);
  return readReview(db, { familyKey: intent.family_key });
}

export function resolveReview(db, familyKey, at = new Date()) {
  return db.prepare(`
    UPDATE memory_reviews
    SET status = 'resolved', resolved_at = ?, updated_at = ?
    WHERE family_key = ? AND status IN ('pending', 'planned')
  `).run(at.toISOString(), at.toISOString(), familyKey).changes > 0;
}

export function dismissReview(db, familyKey, at = new Date()) {
  const changed = db.prepare(`
    UPDATE memory_reviews
    SET status = 'dismissed', resolved_at = ?, updated_at = ?
    WHERE family_key = ? AND status IN ('pending', 'planned')
  `).run(at.toISOString(), at.toISOString(), familyKey).changes;
  if (!changed) throw publicError("Review item not found", 404);
  return { dismissed: true, family_key: familyKey };
}

export function listReviews(db, { includeClosed = false } = {}) {
  const rows = includeClosed
    ? db.prepare("SELECT * FROM memory_reviews ORDER BY updated_at DESC LIMIT 100").all()
    : db.prepare("SELECT * FROM memory_reviews WHERE status IN ('pending', 'planned') ORDER BY updated_at DESC LIMIT 100").all();
  return rows.map(presentReview);
}

export function readReview(db, { reviewId, familyKey }) {
  const row = reviewId
    ? db.prepare("SELECT * FROM memory_reviews WHERE review_id = ?").get(reviewId)
    : db.prepare("SELECT * FROM memory_reviews WHERE family_key = ?").get(familyKey);
  return row ? presentReview(row) : null;
}

export async function deferReview(db, input, options = {}) {
  const request = parseContract(deferReviewSchema, input);
  const review = readReview(db, { reviewId: request.review_id });
  if (!review) throw publicError("Review item not found", 404);
  if (review.status === "deferred_external" && review.notion_page_id) {
    return { ...externalReceipt(review), replay: true };
  }
  if (!ACTIVE_STATUSES.includes(review.status)) {
    throw publicError("Only pending or planned reviews can be deferred", 409);
  }

  const exported = await writeDeferredReview(review, request, options);
  const now = new Date().toISOString();
  return transaction(db, () => {
    const current = readReview(db, { reviewId: request.review_id });
    if (!current || !ACTIVE_STATUSES.includes(current.status)) {
      throw publicError("Review item changed while it was being deferred", 409);
    }
    db.prepare(`
      UPDATE memory_reviews
      SET intent_json = '{}', reason = '详见 Notion', status = 'deferred_external',
          notion_page_id = ?, notion_url = ?, deferred_at = ?, updated_at = ?
      WHERE review_id = ?
    `).run(exported.page_id, exported.url, now, now, request.review_id);
    return externalReceipt(readReview(db, { reviewId: request.review_id }));
  });
}

function presentReview(row) {
  return {
    review_id: row.review_id,
    family_key: row.family_key,
    status: row.status || "pending",
    reason: row.reason,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at || null,
    notion_page_id: row.notion_page_id || null,
    notion_url: row.notion_url || null,
    deferred_at: row.deferred_at || null,
    intent: JSON.parse(row.intent_json || "{}"),
  };
}

function externalReceipt(review) {
  return {
    review_id: review.review_id,
    family_key: review.family_key,
    status: review.status,
    notion_page_id: review.notion_page_id,
    notion_url: review.notion_url,
    deferred_at: review.deferred_at,
    note: "详见 Notion",
  };
}
