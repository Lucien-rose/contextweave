import { prepareVectorRecall, syncVectorIndex } from "../vector-retrieval.js";
import { vectorDeployment, loadVectorGeneration, saveMigrationCheck, generationCoverage } from "./deployment.js";
import { publicError } from "../lib/error.js";

export async function compareVectorGenerations(db, { queries }, options = {}) {
  if (!Array.isArray(queries) || queries.length < 1 || queries.length > 20 || queries.some(q => typeof q !== "string" || !q.trim() || q.length > 2000)) {
    throw publicError("Provide 1–20 bounded comparison queries");
  }
  const d = vectorDeployment(db);
  if (!d?.candidate_identity) throw publicError("No candidate generation", 409);
  const rows = [];
  for (const query of queries) {
    const [blue, green] = await Promise.all([d.active_identity, d.candidate_identity].map(identity =>
      prepareVectorRecall(db, { ...options, query, index: loadVectorGeneration(db, identity),
        mode: "on", syncIndex: false, ensureStore: false })));
    const ids = result => result.items.filter(i => i.qualified).map(i => i.id);
    const before = ids(blue), after = ids(green);
    rows.push({ blue: before, green: after, overlap: after.filter(id => before.includes(id)).length,
      blue_error: blue.reason, green_error: green.reason });
  }
  return saveMigrationCheck(db, d, { candidate_ok: rows.every(row => !row.green_error) && !generationCoverage(db, d.candidate_identity).missing,
    queries: rows, quality_requires_owner_review: true });
}
export { syncVectorIndex };
