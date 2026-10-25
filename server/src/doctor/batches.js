import { parseContract } from "../lib/contract.js";
import { transaction } from "../lib/transaction.js";
import { publicError } from "../lib/error.js";
import { portraitHash } from "../portrait/store.js";
import { enqueuePortraitJob } from "../portrait/queue.js";
import { preserveBatchEvidence } from "../processing/input.js";
import { doctorBatchSchema } from "./contract.js";

export { ensureDoctorSchema } from "./schema.js";

export function submitDoctorBatch(db, rawInput) {
  const input = parseContract(doctorBatchSchema, rawInput);
  const fingerprint = portraitHash(input);
  return transaction(db, () => {
    const previous = db.prepare("SELECT * FROM doctor_batches WHERE batch_id=?").get(input.batch_id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw publicError("Steward batch ID reused with different content", 409);
      return { ...doctorBatchReceipt(db, input.batch_id), duplicate: true };
    }
    const events = preserveBatchEvidence(db, input);
    const checkpoint = { source_surface: input.source_surface, session_id: input.session_id,
      source_revision: input.source_revision, first_event_id: events[0].event_id,
      through_event_id: events.at(-1).event_id, event_count: events.length };
    const job = enqueuePortraitJob(db, { id: `doctor:${input.batch_id}`, kind: "doctor",
      subject_id: input.subject_id, session_id: input.session_id, input: { ...input, events } });
    db.prepare("INSERT INTO doctor_batches VALUES (?, ?, ?, ?, NULL, ?)")
      .run(input.batch_id, fingerprint, job.id, JSON.stringify(checkpoint), new Date().toISOString());
    return doctorBatchReceipt(db, input.batch_id);
  });
}

export function doctorBatchReceipt(db, batchId) {
  const row = db.prepare(`SELECT b.*, j.status, j.attempts, j.error_code FROM doctor_batches b
    JOIN portrait_jobs j ON j.id=b.job_id WHERE b.batch_id=?`).get(batchId);
  if (!row) throw publicError("Steward batch not found", 404);
  return { batch_id: row.batch_id, job_id: row.job_id, status: row.status, attempts: row.attempts,
    error_code: row.error_code, checkpoint: JSON.parse(row.checkpoint_json),
    result: row.receipt_json ? JSON.parse(row.receipt_json) : null,
    host_may_advance_cursor: row.status === "done", cursor_owned_by: "host" };
}
