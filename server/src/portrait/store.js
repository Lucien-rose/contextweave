import { defaults } from "../defaults.js";
import { createHash } from "node:crypto";
import { transaction } from "../lib/transaction.js";
import { publicError } from "../lib/error.js";
import { parseContract } from "../lib/contract.js";
import { portraitChangeSchema } from "./contract.js";

export const portraitHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function portraitRevision(db, subjectId = "user") {
  return db.prepare("SELECT revision FROM portrait_subjects WHERE subject_id = ?").get(subjectId)?.revision || 0;
}

export function getPortraitItem(db, subjectId, itemId) {
  const row = db.prepare("SELECT * FROM portrait_items WHERE subject_id = ? AND id = ?").get(subjectId, itemId);
  return row ? hydratePortrait(row) : null;
}

export function listPortraitItems(db, subjectId) {
  return db.prepare(`SELECT * FROM portrait_items WHERE subject_id = ? AND status != 'purged'
    ORDER BY priority DESC, domain, id`).all(subjectId)
    .map(hydratePortrait);
}

export function portraitEvidence(db, subjectId, itemId) {
  return db.prepare(`SELECT source_json FROM portrait_evidence WHERE subject_id = ? AND item_id = ?
    ORDER BY source_type, source_id`).all(subjectId, itemId).map((row) => JSON.parse(row.source_json));
}

export function applyPortraitChange(db, rawInput, { at = new Date() } = {}) {
  const input = parseContract(portraitChangeSchema, rawInput);
  const fingerprint = portraitHash(input);
  return transaction(db, () => {
    const previous = db.prepare("SELECT * FROM portrait_changes WHERE change_id = ?").get(input.change_id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw publicError("change_id already used with different input");
      return { ...JSON.parse(previous.result_json), duplicate: true };
    }
    if (input.risk === "ambiguous") return { status: "needs_judgment", applied: false };
    let current = getPortraitItem(db, input.subject_id, input.item_id);
    if ((current?.revision || 0) !== input.expected_revision) throw publicError("Stale portrait revision", 409);
    if (current?.status === "purged") throw publicError("Purged state requires a new episode ID");
    if (current?.time_scale === "living" && Date.parse(current.expires_at) + defaults.expiredGraceDays * 86400000 <= at.getTime()) {
      throw publicError("Expired grace ended; create a new episode ID");
    }
    if (!current && input.operation === "reinforce") throw publicError("Cannot reinforce a missing portrait");
    const now = at.toISOString();
    const data = input.operation === "upsert" ? input.data : reinforce(current, input, at);
    validateEvidence(db, input.source_refs, data.sensitivity);
    if (data.time_scale === "living" && data.status === "active" && Date.parse(data.expires_at) <= at.getTime()) {
      throw publicError("Active living state requires a future expiry");
    }
    const hash = portraitHash(portraitContent(data));
    if (!current && data.time_scale === "stable") {
      const duplicate = db.prepare(`SELECT id FROM portrait_items WHERE subject_id = ? AND content_hash = ?
        AND status = 'active' ORDER BY id LIMIT 1`).get(input.subject_id, hash);
      if (duplicate) current = getPortraitItem(db, input.subject_id, duplicate.id);
    }
    const itemId = current?.id || input.item_id;
    const revision = (current?.revision || 0) + 1;
    db.prepare(`INSERT INTO portrait_items (subject_id, id, domain, time_scale, title, content,
      sensitivity, use_policy, seed_eligible, priority, confidence, status, expires_at, revision,
      content_hash, first_seen_at, last_confirmed_at, updated_at, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(subject_id, id) DO UPDATE SET domain=excluded.domain, time_scale=excluded.time_scale,
      title=excluded.title, content=excluded.content, sensitivity=excluded.sensitivity, use_policy=excluded.use_policy,
      seed_eligible=excluded.seed_eligible, priority=excluded.priority, confidence=excluded.confidence,
      status=excluded.status, expires_at=excluded.expires_at, revision=excluded.revision,
      content_hash=excluded.content_hash, last_confirmed_at=excluded.last_confirmed_at, updated_at=excluded.updated_at,
      details_json=excluded.details_json`)
      .run(input.subject_id, itemId, data.domain, data.time_scale, data.title, data.content,
        data.sensitivity, data.use_policy, Number(data.seed_eligible), data.priority, data.confidence,
        data.status, data.expires_at ? new Date(data.expires_at).toISOString() : null, revision, hash,
        current?.first_seen_at || now, now, now, JSON.stringify({ chapter: data.chapter || null }));
    const evidence = db.prepare("INSERT OR IGNORE INTO portrait_evidence VALUES (?, ?, ?, ?, ?)");
    for (const ref of input.source_refs) evidence.run(input.subject_id, itemId, ref.source_type, ref.source_id, JSON.stringify(ref));
    bumpPortraitRevision(db, input.subject_id);
    const result = { status: "applied", applied: true, duplicate: false, subject_id: input.subject_id,
      item_id: itemId, revision, content_hash: hash, content_changed: current?.content_hash !== hash };
    db.prepare("INSERT INTO portrait_changes VALUES (?, ?, ?, ?)").run(input.change_id, fingerprint, JSON.stringify(result), now);
    return result;
  });
}

export function bumpPortraitRevision(db, subjectId) {
  db.prepare(`INSERT INTO portrait_subjects VALUES (?, 1) ON CONFLICT(subject_id)
    DO UPDATE SET revision = revision + 1`).run(subjectId);
}

export function portraitContent(item) {
  return { domain: item.domain, time_scale: item.time_scale, title: item.title, content: item.content,
    sensitivity: item.sensitivity, use_policy: item.use_policy, seed_eligible: item.seed_eligible,
    priority: item.priority, status: item.status, chapter: item.chapter || null };
}

function reinforce(current, input, at) {
  if (current.time_scale === "living") {
    if (Date.parse(current.expires_at) + defaults.expiredGraceDays * 86400000 <= at.getTime()) {
      throw publicError("Expired grace ended; create a new episode ID");
    }
    if (!input.expires_at || Date.parse(input.expires_at) <= at.getTime()) {
      throw publicError("Living reinforcement requires a new future expiry");
    }
    return { ...current, status: "active", expires_at: input.expires_at };
  }
  return current;
}

function validateEvidence(db, sources, sensitivity) {
  const rank = { personal: 0, private: 1, sensitive: 2, intimate: 3 };
  for (const source of sources) {
    if (source.material_id) {
      const material = db.prepare("SELECT sensitivity FROM source_materials WHERE id=?").get(source.material_id);
      if (!material) throw publicError("Portrait source material is missing");
      if (rank[sensitivity] < rank[material.sensitivity]) throw publicError("Portrait cannot lower evidence sensitivity");
    }
    if (source.source_context?.sensitivity && rank[sensitivity] < rank[source.source_context.sensitivity]) {
      throw publicError("Portrait cannot lower evidence sensitivity");
    }
    if (source.source_type !== "memory") continue;
    const memory = db.prepare("SELECT content_hash, sensitivity FROM memories WHERE id = ? AND status != 'deleted'").get(source.source_id);
    if (!memory || (source.source_hash && source.source_hash !== memory.content_hash)) {
      throw publicError("Portrait evidence memory is missing or revised");
    }
    if (rank[sensitivity] < rank[memory.sensitivity]) throw publicError("Portrait cannot lower evidence sensitivity");
  }
}

function hydratePortrait(row) {
  const { details_json, ...item } = row;
  return { ...item, seed_eligible: Boolean(row.seed_eligible), ...JSON.parse(details_json) };
}
