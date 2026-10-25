export function ensureDoctorSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS doctor_batches (
    batch_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, job_id TEXT NOT NULL,
    checkpoint_json TEXT NOT NULL, receipt_json TEXT, created_at TEXT NOT NULL
  );`);
}
