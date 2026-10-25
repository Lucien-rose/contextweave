import { runtimeSettings } from "./queue.js";
import { createModelSettingsStore } from "../models/settings.js";

export function portraitRuntimeStatus(db) {
  const routes = createModelSettingsStore().routes();
  const counts = (table) => Object.fromEntries(db.prepare(`SELECT status, COUNT(*) AS n FROM ${table} GROUP BY status`).all()
    .map((row) => [row.status, row.n]));
  return { settings: runtimeSettings(db), configured: { portrait: Boolean(routes.portrait), summary: Boolean(routes.summary) },
    observations: counts("portrait_observations"), jobs: counts("portrait_jobs"), candidates: counts("portrait_candidates"),
    recent_jobs: db.prepare(`SELECT id, kind, status, attempts, error_code, created_at, updated_at FROM portrait_jobs
      ORDER BY updated_at DESC LIMIT 10`).all(), canonical_memory_autowrite: false };
}

export function prunePortraitRuntime(db, at = new Date()) {
  const cutoff = new Date(at.getTime() - 30 * 86400000).toISOString();
  const jobs = db.prepare(`UPDATE portrait_jobs SET input_json='{}', snapshot_json=NULL, proposals_json=NULL, result_json=NULL
    WHERE status='done' AND updated_at<? AND input_json!='{}'`).run(cutoff).changes;
  const observations = db.prepare(`UPDATE portrait_observations SET payload_json='{}'
    WHERE status IN ('done', 'skipped') AND created_at<? AND payload_json!='{}'`).run(cutoff).changes;
  const candidates = db.prepare(`UPDATE portrait_candidates SET payload_json='{}' WHERE status!='pending'
    AND updated_at<? AND payload_json!='{}'`).run(new Date(at.getTime() - 14 * 86400000).toISOString()).changes;
  return { jobs, observations, candidates };
}
