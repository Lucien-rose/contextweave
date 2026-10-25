import { defaults } from "../defaults.js";
import { parseContract } from "../lib/contract.js";
import { publicError } from "../lib/error.js";
import { transaction } from "../lib/transaction.js";
import { runtimeSettings, claimPortraitJob, ownsJob, finishPortraitJob } from "../portrait/queue.js";
import { readPortrait } from "../portrait/read.js";
import { savePortraitCandidate, proposalSources } from "../portrait/proposals.js";
import { sensitivityRank, jsonOutputSchema, WRITER_INSTRUCTION } from "../portrait/runtime-contract.js";
import { batchSensitivity } from "../processing/input.js";
import { resolveModelRoute } from "../models/settings.js";
import { generateStructured } from "../models/client.js";
import { doctorProposalSchema } from "./contract.js";

export async function runDoctorBatch(db, { writer, fetchImpl } = {}) {
  const connection = writer ? null : resolveModelRoute("portrait");
  if (!writer && !connection) return { status: "not-configured" };
  const job = claimPortraitJob(db, new Date(), { kind: "doctor" });
  if (!job) return { status: "idle" };
  try {
    const input = JSON.parse(job.input_json);
    const maxSensitivity = runtimeSettings(db).max_sensitivity;
    let sensitivity = batchSensitivity(input.events);
    if (sensitivityRank[sensitivity] > sensitivityRank[maxSensitivity]) throw publicError("Steward batch exceeds configured sensitivity", 403);
    const snapshot = job.snapshot_json ? JSON.parse(job.snapshot_json) : comparisonSnapshot(db, input, maxSensitivity);
    sensitivity = batchSensitivity([{ sensitivity }, ...snapshot.portrait, ...snapshot.memories]);
    if (sensitivityRank[sensitivity] > sensitivityRank[maxSensitivity]) throw publicError("Steward snapshot exceeds configured sensitivity", 403);
    const payload = { events: input.events.map(({ source_refs, ...event }) => event), snapshot };
    const raw = job.proposals_json ? JSON.parse(job.proposals_json) : writer ? await writer(payload)
      : (await generateStructured(connection, {
        instruction: WRITER_INSTRUCTION + ` Offline Steward audit: compare only the supplied bounded snapshot. Report omissions, conflicts and Lineage changes as proposals. Assistant promises may support shared-event memory candidates but never user portrait facts. Do not manufacture evidence or automatic promotions. family_changes target only supplied memory IDs; reasons must distinguish explicit/inferred/unknown. Total new-memory plus Lineage proposals is at most ${defaults.memoryCandidates}. No writes, tools or automatic repairs.`,
        input: payload, schema: jsonOutputSchema(doctorProposalSchema), name: "doctor_proposals" }, { fetchImpl })).value;
    const proposals = parseContract(doctorProposalSchema, raw);
    if (!ownsJob(db, job)) throw publicError("Steward lease expired", 409);
    db.prepare("UPDATE portrait_jobs SET snapshot_json=?, proposals_json=? WHERE id=? AND lease_token=?")
      .run(JSON.stringify(snapshot), JSON.stringify(proposals), job.id, job.lease_token);
    return transaction(db, () => {
      const candidates = [];
      const groups = [["portrait", proposals.portrait_changes], ["memory", proposals.memory_candidates], ["family", proposals.family_changes]];
      for (const [kind, entries] of groups) for (const [index, proposal] of entries.entries()) {
        if (kind === "portrait" && proposal.evidence.some((ref) => input.events.find((event) => event.event_id === ref.event_id)?.role !== "user")) {
          throw publicError("Portrait proposal requires user-authored evidence");
        }
        const target = kind === "family" ? snapshot.memories.find((memory) => memory.id === proposal.target_memory_id) : null;
        if (kind === "family" && !target) throw publicError("Lineage proposal requires an inspected snapshot target");
        const sourceRefs = proposalSources(proposal, input.events);
        candidates.push(savePortraitCandidate(db, job, `doctor-${kind}`, index,
          { proposal, source_refs: sourceRefs, sensitivity, snapshot: kind === "portrait" ? snapshot.portrait
            : target ? [target] : [], title: proposal.title || proposal.data?.title || "Steward proposal" }, "doctor-host-review-required"));
      }
      const result = { candidate_ids: candidates.map((row) => row.candidate_id),
        portrait_proposals: proposals.portrait_changes.length, memory_proposals: proposals.memory_candidates.length,
        family_proposals: proposals.family_changes.length, canonical_memories_written: 0, portraits_written: 0,
        compared_memory_ids: snapshot.memories.map((memory) => memory.id) };
      db.prepare("UPDATE doctor_batches SET receipt_json=? WHERE job_id=?").run(JSON.stringify(result), job.id);
      return finishPortraitJob(db, job, result);
    });
  } catch (error) {
    const needsReview = [400, 403, 409].includes(error.statusCode);
    return finishPortraitJob(db, needsReview ? { ...job, attempts: 3 } : job,
      { message: error.publicMessage || "Steward analysis failed" },
      needsReview ? "source-or-proposal-needs-review" : "provider-or-analysis-failed");
  }
}

function comparisonSnapshot(db, input, maxSensitivity) {
  const portrait = readPortrait(db, { subject_id: input.subject_id, context: "private",
    intimacy_mode: maxSensitivity === "intimate" ? "proactive" : "off",
    query: input.events.map((event) => event.text).join(" ").slice(0, 4000), max_chars: 12000 }).items
    .filter((item) => sensitivityRank[item.sensitivity] <= sensitivityRank[maxSensitivity]);
  const memories = [];
  let chars = 0;
  for (const id of input.memory_ids) {
    const row = db.prepare(`SELECT id, title, content, recall_summary, content_hash, updated_at, status, family_key,
      sensitivity FROM memories WHERE id=? AND status='active'`).get(id);
    if (!row || sensitivityRank[row.sensitivity] > sensitivityRank[maxSensitivity]) throw publicError("Steward comparison memory missing or outside sensitivity", 403);
    const { content, recall_summary, ...header } = row;
    const receipt = db.prepare(`SELECT explanation_json, sensitivity FROM family_change_receipts
      WHERE family_key=? ORDER BY sequence DESC LIMIT 1`).get(row.family_key);
    const latestChange = receipt && sensitivityRank[receipt.sensitivity] <= sensitivityRank[maxSensitivity]
      ? JSON.parse(receipt.explanation_json) : null;
    const item = { ...header, excerpt: (recall_summary || content).slice(0, 3000),
      excerpt_truncated: (recall_summary || content).length > 3000,
      latest_change: latestChange };
    if (chars + JSON.stringify(item).length > 16000) break;
    memories.push(item);
    chars += JSON.stringify(item).length;
  }
  return { portrait, memories, coverage: "host-selected-memory-ids-and-query-matched-portraits" };
}
