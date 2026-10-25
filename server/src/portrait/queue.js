import { randomUUID } from "node:crypto";
import { transaction } from "../lib/transaction.js";
import { publicError } from "../lib/error.js";
import { parseContract } from "../lib/contract.js";
import { recordSourceMaterial } from "../source-materials.js";
import { portraitHash } from "./store.js";
import { observationSchema, runtimeSettingsSchema, sensitivityRank } from "./runtime-contract.js";

export function runtimeSettings(db) {
  const row = db.prepare("SELECT value_json FROM portrait_runtime_settings WHERE id=1").get();
  return runtimeSettingsSchema.parse(row ? JSON.parse(row.value_json) : {});
}

export function saveRuntimeSettings(db, patch) {
  const value = parseContract(runtimeSettingsSchema, { ...runtimeSettings(db), ...patch });
  db.prepare("INSERT INTO portrait_runtime_settings VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json")
    .run(JSON.stringify(value));
  return value;
}

export function observePortrait(db, input, { at = new Date() } = {}) {
  const event = parseContract(observationSchema, input);
  const fingerprint = portraitHash(event);
  const previous = db.prepare("SELECT fingerprint, status FROM portrait_observations WHERE event_id=?").get(event.event_id);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw publicError("Observation ID already used for different content", 409);
    return { event_id: event.event_id, status: previous.status, duplicate: true };
  }
  const skipped = event.role !== "user" || event.scope !== "real" || event.hint === "skip"
    || (event.hint === "auto" && /^(?:[\s\p{P}\p{S}]|嗯|哦|好|呀|啊|哈|ok|yes|no|thanks|谢谢)+$/iu.test(event.text));
  const status = skipped ? "skipped" : "pending";
  transaction(db, () => {
    for (const ref of event.source_refs) {
      const level = ref.source_type === "memory" ? db.prepare("SELECT sensitivity FROM memories WHERE id=? AND status='active'")
        .get(ref.source_id)?.sensitivity : ref.source_context?.sensitivity;
      if (level && sensitivityRank[level] > sensitivityRank[event.sensitivity]) event.sensitivity = level;
      if (ref.source_context && !ref.source_context.content.includes(event.text)) {
        throw publicError("Observation text must be contained in its original source context");
      }
    }
    const refs = event.source_refs.map((ref) => {
      const source = { ...ref, source_context: { ...(ref.source_context || {}), content: ref.source_context?.content || event.text,
        sensitivity: event.sensitivity, occurred_at: event.occurred_at } };
      const material = recordSourceMaterial(db, source);
      return { ...source, material_id: material.id };
    });
    db.prepare("INSERT INTO portrait_observations VALUES (?, ?, ?, ?, ?, ?, NULL, ?)")
      .run(event.event_id, event.subject_id, event.session_id, fingerprint, JSON.stringify({ ...event, source_refs: refs }), status, at.toISOString());
  });
  return { event_id: event.event_id, status, duplicate: false };
}

export function formPortraitBatch(db, { force = false, at = new Date() } = {}) {
  const settings = runtimeSettings(db);
  const groups = db.prepare(`SELECT subject_id, session_id, MIN(created_at) AS oldest, COUNT(*) AS n
    FROM portrait_observations WHERE status='pending' GROUP BY subject_id, session_id ORDER BY oldest`).all();
  for (const group of groups) {
    if (!force && group.n < settings.batch_min && at.getTime() - Date.parse(group.oldest) < settings.wait_seconds * 1000) continue;
    const rows = db.prepare(`SELECT * FROM portrait_observations WHERE status='pending' AND subject_id=? AND session_id=?
      ORDER BY created_at, event_id LIMIT 8`).all(group.subject_id, group.session_id);
    const events = [];
    let chars = 0;
    for (const row of rows) {
      const event = JSON.parse(row.payload_json);
      if (sensitivityRank[event.sensitivity] > sensitivityRank[settings.max_sensitivity]) continue;
      if (chars + event.text.length > 16000) break;
      events.push(event);
      chars += event.text.length;
    }
    if (!events.length) continue;
    return transaction(db, () => {
      const job = enqueuePortraitJob(db, { id: `batch:${portraitHash(events.map((event) => event.event_id))}`,
        kind: "portrait", subject_id: group.subject_id, session_id: group.session_id, input: { events } }, at);
      for (const event of events) db.prepare("UPDATE portrait_observations SET status='queued', job_id=? WHERE event_id=?")
        .run(job.id, event.event_id);
      return job;
    });
  }
  return null;
}

export function enqueuePortraitJob(db, { id, kind, subject_id, session_id, input }, at = new Date()) {
  const now = at.toISOString();
  db.prepare(`INSERT OR IGNORE INTO portrait_jobs (id, kind, subject_id, session_id, status, input_json, available_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`).run(id, kind, subject_id, session_id, JSON.stringify(input), now, now, now);
  return db.prepare("SELECT * FROM portrait_jobs WHERE id=?").get(id);
}

export function claimPortraitJob(db, at = new Date(), { kind = null } = {}) {
  return transaction(db, () => {
    const now = at.toISOString();
    db.prepare(`UPDATE portrait_jobs SET status=CASE WHEN attempts>=3 THEN 'review' ELSE 'pending' END,
      lease_token=NULL, lease_until=NULL, error_code='lease-expired' WHERE status='running' AND lease_until<=?`).run(now);
    const filter = kind ? "kind=?" : "kind!='doctor'";
    const job = db.prepare(`SELECT * FROM portrait_jobs WHERE status='pending' AND available_at<=? AND ${filter}
      ORDER BY created_at, id LIMIT 1`).get(...(kind ? [now, kind] : [now]));
    if (!job) return null;
    const token = randomUUID();
    db.prepare(`UPDATE portrait_jobs SET status='running', attempts=attempts+1, lease_token=?, lease_until=?, updated_at=? WHERE id=?`)
      .run(token, new Date(at.getTime() + 15 * 60 * 1000).toISOString(), now, job.id);
    return { ...job, status: "running", attempts: job.attempts + 1, lease_token: token };
  });
}

export function ownsJob(db, job) {
  return Boolean(db.prepare("SELECT 1 FROM portrait_jobs WHERE id=? AND status='running' AND lease_token=? AND lease_until>?")
    .get(job.id, job.lease_token, new Date().toISOString()));
}

export function finishPortraitJob(db, job, result, errorCode = null) {
  const now = new Date();
  const retry = errorCode && job.attempts < 3;
  const status = errorCode ? retry ? "pending" : "review" : "done";
  const updated = db.prepare(`UPDATE portrait_jobs SET status=?, result_json=?, error_code=?, available_at=?, updated_at=?,
    lease_token=NULL, lease_until=NULL WHERE id=? AND lease_token=?`)
    .run(status, JSON.stringify(result), errorCode, new Date(now.getTime() + (retry ? 60000 * job.attempts : 0)).toISOString(),
      now.toISOString(), job.id, job.lease_token);
  if (!updated.changes) return { job_id: job.id, status: "lease-lost" };
  if (!errorCode) db.prepare("UPDATE portrait_observations SET status='done' WHERE job_id=?").run(job.id);
  return { job_id: job.id, status, result };
}

export function retryPortraitJob(db, id) {
  const updated = db.prepare(`UPDATE portrait_jobs SET status='pending', attempts=0, snapshot_json=NULL, proposals_json=NULL,
    result_json=NULL, error_code=NULL, available_at=?, updated_at=? WHERE id=? AND status='review'`)
    .run(new Date().toISOString(), new Date().toISOString(), id);
  if (!updated.changes) throw publicError("Review job not found", 404);
  return { job_id: id, status: "pending" };
}
