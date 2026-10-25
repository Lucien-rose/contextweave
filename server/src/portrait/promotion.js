import { timezone } from "../defaults.js";
import { portraitEvidence, portraitHash } from "./store.js";

export function promotionSupport(sources) {
  const observations = [...new Map(sources.flatMap(ref => ref.metadata?.portrait_observation
    ? [[ref.metadata.portrait_observation.event_id, ref.metadata.portrait_observation]] : [])).values()];
  const times = observations.map(item => item.occurred_at).sort();
  return { observations: observations.length,
    distinct_sessions: new Set(observations.map(item => item.session_id)).size,
    distinct_dates: new Set(observations.map(item => new Date(item.occurred_at).toLocaleDateString("sv-SE", { timeZone: timezone }))).size,
    first_seen_at: times[0] || null, last_seen_at: times.at(-1) || null,
    counting_timezone: timezone, automatic_promotion_allowed: false };
}

export function savePromotionProposal(db, job, current, change) {
  const id = `promotion:${portraitHash([job.subject_id, current.id, current.revision, change.data]).slice(0, 48)}`;
  const previous = db.prepare("SELECT payload_json FROM portrait_candidates WHERE id=?").get(id);
  const oldSources = previous ? JSON.parse(previous.payload_json).source_refs || [] : [];
  const sources = [...new Map([...portraitEvidence(db, job.subject_id, current.id), ...oldSources, ...change.source_refs]
    .map(ref => [`${ref.source_type}:${ref.source_id}`, ref])).values()].slice(-64);
  const payload = { title: change.data.title, sensitivity: change.data.sensitivity,
    item_id: current.id, expected_revision: current.revision, from_time_scale: current.time_scale,
    to_time_scale: change.data.time_scale, suggested_operation: "promote", change,
    source_refs: sources, support: { ...promotionSupport(sources), coverage: "bounded-last-64-source-references" },
    guidance: "Counts describe evidence coverage, not qualification. Inspect exact evidence and current revision before a host-owned profile update." };
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO portrait_candidates (id, job_id, kind, payload_json, reason, created_at, updated_at)
    VALUES (?, ?, 'promotion', ?, 'host-must-review-promotion', ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at
    WHERE portrait_candidates.status='pending'`)
    .run(id, job.id, JSON.stringify(payload), now, now);
  return { candidate_id: id, status: "needs_review", reason: "host-must-review-promotion" };
}
