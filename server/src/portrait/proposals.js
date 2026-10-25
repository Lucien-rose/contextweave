import { publicError } from "../lib/error.js";
import { portraitHash, getPortraitItem, applyPortraitChange, portraitEvidence } from "./store.js";
import { sensitivityRank } from "./runtime-contract.js";
import { savePromotionProposal } from "./promotion.js";

export function savePortraitCandidate(db, job, kind, index, payload, reason) {
  const id = `${job.id}:${kind}:${index}`;
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO portrait_candidates (id, job_id, kind, payload_json, reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, job.id, kind, JSON.stringify(payload), reason, now, now);
  return { candidate_id: id, status: "needs_review", reason };
}

export function proposalSources(proposal, events) {
  const selected = [];
  for (const citation of proposal.evidence) {
    const event = events.find((item) => item.event_id === citation.event_id);
    if (!event || !event.text.includes(citation.quote)) throw publicError("Proposal cites unsupported evidence");
    for (const { source_context, ...ref } of event.source_refs) selected.push({ ...ref, excerpt: citation.quote,
      metadata: { ...ref.metadata, portrait_observation: ref.source_type === "memory" ? null : { event_id: event.event_id,
        session_id: event.session_id, occurred_at: event.occurred_at } } });
  }
  return [...new Map(selected.map((ref) => [`${ref.source_type}:${ref.source_id}`, ref])).values()].slice(0, 20);
}

export async function applyRuntimeProposal(db, job, proposal, index, { events, snapshot, settings, judge, beforeApply = () => {} }) {
  const sources = proposalSources(proposal, events);
  const snapshotItem = snapshot.find((item) => item.id === proposal.item_id);
  const changeId = `${job.id}:portrait:${index}`;
  const saved = db.prepare("SELECT result_json FROM portrait_changes WHERE change_id=?").get(changeId);
  if (saved) return { ...JSON.parse(saved.result_json), duplicate: true };
  const current = proposal.item_id ? getPortraitItem(db, job.subject_id, proposal.item_id) : null;
  if (proposal.item_id && (!snapshotItem || !current || current.revision !== proposal.expected_revision
    || snapshotItem.revision !== proposal.expected_revision)) {
    return savePortraitCandidate(db, job, "portrait", index, { proposal, source_refs: sources }, "stale-or-unknown-item");
  }
  if (proposal.operation === "reinforce" && !current) throw publicError("Cannot reinforce an unknown portrait");
  const citedEvents = events.filter((event) => proposal.evidence.some((quote) => quote.event_id === event.event_id));
  let data = proposal.operation === "upsert" ? proposal.data : null;
  if (proposal.operation === "upsert" && !data) throw publicError("Portrait upsert requires data");
  const timeScale = data?.time_scale || current.time_scale;
  const sensitivity = citedEvents.reduce((maximum, event) => sensitivityRank[event.sensitivity] > sensitivityRank[maximum]
    ? event.sensitivity : maximum, data?.sensitivity || current?.sensitivity || "private");
  const expiry = new Date(Date.now() + settings.living_days * 86400000).toISOString();
  if (data) data = { ...data, sensitivity, use_policy: "silent", seed_eligible: false,
    ...(timeScale === "living" ? { expires_at: expiry } : {}) };
  const itemId = current?.id || `portrait:${portraitHash([job.subject_id, data.domain, timeScale,
    normalize(data.title), ...(timeScale === "living" ? [citedEvents[0].event_id] : [])]).slice(0, 32)}`;
  const existing = current || getPortraitItem(db, job.subject_id, itemId);
  if (!current && existing) return savePortraitCandidate(db, job, "portrait", index, { proposal, source_refs: sources }, "existing-item-requires-revision");
  const change = { change_id: changeId, subject_id: job.subject_id, item_id: itemId,
    expected_revision: current?.revision || 0, operation: proposal.operation, risk: "clear", source_refs: sources,
    ...(data ? { data } : {}), ...(timeScale === "living" && !data ? { expires_at: expiry } : {}) };
  if (current && data && ["living", "chapter", "stable"].indexOf(data.time_scale)
    > ["living", "chapter", "stable"].indexOf(current.time_scale)) {
    beforeApply();
    return savePromotionProposal(db, job, current, change);
  }
  const policy = reviewPolicy(db, current, data, sources, proposal.risk);
  const historical = job.kind === "backfill" && timeScale !== "stable";
  if (historical || policy === "review" || (policy === "judge" && (!judge || await judge({ events, snapshot: current, proposal: change, index }) !== "approve"))) {
    return savePortraitCandidate(db, job, "portrait", index, { change, evidence: proposal.evidence }, policy === "review" ? "stable-policy" : "needs-judgment");
  }
  beforeApply();
  return applyPortraitChange(db, change);
}

export function readPortraitCandidate(db, id, { maxSensitivity = "intimate", maxChars = 16000, sourceId = null, offset = 0 } = {}) {
  const candidate = db.prepare("SELECT * FROM portrait_candidates WHERE id=? AND status='pending'").get(id);
  if (!candidate) throw publicError("Pending candidate not found", 404);
  const payload = JSON.parse(candidate.payload_json);
  const level = payload.sensitivity || payload.change?.data?.sensitivity || payload.proposal?.data?.sensitivity || "intimate";
  if (sensitivityRank[level] > sensitivityRank[maxSensitivity]) throw publicError("Candidate is not visible in this context", 403);
  const sources = payload.source_refs || payload.change?.source_refs || [];
  const evidence = sources.map((ref) => {
    if (ref.material_id) {
      const material = db.prepare("SELECT id, content, content_hash, sensitivity, occurred_at, speaker FROM source_materials WHERE id=?").get(ref.material_id);
      if (!material) throw publicError("Candidate evidence is missing", 409);
      return material;
    }
    if (ref.source_type === "memory") {
      const memory = db.prepare("SELECT id, content, content_hash, sensitivity FROM memories WHERE id=? AND status='active'").get(ref.source_id);
      if (!memory || (ref.source_hash && ref.source_hash !== memory.content_hash)) throw publicError("Candidate evidence is stale", 409);
      return memory;
    }
    return { id: ref.source_id, content: ref.excerpt || "", sensitivity: payload.sensitivity || "intimate", excerpt_only: true };
  });
  if (evidence.some((item) => sensitivityRank[item.sensitivity] > sensitivityRank[maxSensitivity])) throw publicError("Candidate evidence is not visible in this context", 403);
  const sourceMetadata = (refs) => refs.map(({ source_context, excerpt, ...ref }) => ref);
  if (payload.source_refs) payload.source_refs = sourceMetadata(payload.source_refs);
  if (payload.change?.source_refs) payload.change.source_refs = sourceMetadata(payload.change.source_refs);
  if (payload.proposal?.evidence) payload.proposal.evidence = payload.proposal.evidence.map(({ event_id }) => ({ event_id }));
  const limit = Math.max(2048, Math.min(50000, Number(maxChars) || 16000));
  let result = { candidate_id: id, kind: candidate.kind, ...payload, evidence: [], omitted_evidence: 0,
    canonical_write_allowed: false, guidance: "Inspect exact source frames before a host-owned write. Closing a candidate never writes memory." };
  if (JSON.stringify(result).length > limit - 300) result = { candidate_id: id, kind: candidate.kind, evidence: [],
    proposal_omitted: true, omitted_evidence: 0, canonical_write_allowed: false,
    read_via: { tool: "moss_profile_candidate_read", arguments: { candidate_id: id, max_chars: 50000,
      intimacy_mode: maxSensitivity === "intimate" ? "proactive" : "off" } } };
  const selected = sourceId ? evidence.filter((item) => item.id === sourceId) : evidence;
  if (sourceId && !selected.length) throw publicError("Candidate source not found", 404);
  for (const [index, item] of selected.entries()) {
    const start = sourceId ? Math.max(0, Math.min(item.content.length, Number(offset) || 0)) : 0;
    const frame = { ...item, content: "", start_offset: start, end_offset: start,
      total_chars: item.content.length, truncated: true,
      read_via: { tool: "moss_profile_candidate_read", arguments: { candidate_id: id, source_id: item.id,
        offset: start, max_chars: limit, intimacy_mode: maxSensitivity === "intimate" ? "proactive" : "off" } } };
    result.evidence.push(frame);
    if (JSON.stringify(result).length > limit) {
      result.evidence.pop(); result.omitted_evidence = selected.length - index; break;
    }
    let left = 0, right = item.content.length - start;
    while (left < right) {
      const count = Math.ceil((left + right) / 2);
      frame.content = item.content.slice(start, start + count);
      if (JSON.stringify(result).length <= limit) left = count; else right = count - 1;
    }
    frame.content = item.content.slice(start, start + left);
    frame.end_offset = start + left;
    frame.truncated = frame.end_offset < item.content.length;
    frame.read_via.arguments.offset = frame.end_offset;
    while (JSON.stringify(result).length > limit && frame.content.length) {
      frame.content = frame.content.slice(0, -16);
      frame.end_offset = start + frame.content.length;
      frame.read_via.arguments.offset = frame.end_offset;
      frame.truncated = true;
    }
  }
  return result;
}

function reviewPolicy(db, current, data, sources, risk) {
  const scale = data?.time_scale || current?.time_scale;
  if (scale === "stable" && (!current || (data && current.content !== data.content))) return "review";
  if (current && data && current.time_scale !== data.time_scale) return "review";
  if (risk === "ambiguous") return "judge";
  if (scale === "chapter") return "judge";
  if (data?.confidence < 0.85) return "judge";
  if (current && data && normalize(current.content) !== normalize(data.content)) return "judge";
  if (scale === "stable" && portraitEvidence(db, current.subject_id, current.id).length + sources.length < 2) return "judge";
  return "clear";
}

export function listPortraitCandidates(db, { status = "pending", limit = 20, maxSensitivity = "intimate" } = {}) {
  if (!["pending", "dismissed", "handled"].includes(status)) throw publicError("Invalid candidate status");
  return db.prepare("SELECT * FROM portrait_candidates WHERE status=? ORDER BY created_at LIMIT ?")
    .all(status, Math.max(1, Math.min(50, Number(limit) || 20)))
    .map(({ payload_json, ...row }) => ({ ...row, payload: JSON.parse(payload_json) }))
    .filter(({ payload }) => sensitivityRank[payload.sensitivity || payload.change?.data?.sensitivity || payload.proposal?.data?.sensitivity || "intimate"]
      <= sensitivityRank[maxSensitivity])
    .map(({ payload, ...row }) => ({ ...row, title: payload.title || payload.change?.data?.title || payload.proposal?.data?.title || "Portrait proposal",
      canonical_write_allowed: false, read_via: { tool: "moss_profile_candidate_read", arguments: { candidate_id: row.id,
        intimacy_mode: maxSensitivity === "intimate" ? "proactive" : "off" } } }));
}

export function closePortraitCandidate(db, id, status) {
  if (!["dismissed", "handled"].includes(status)) throw publicError("Candidate can only be dismissed or marked handled");
  const result = db.prepare("UPDATE portrait_candidates SET status=?, updated_at=? WHERE id=? AND status='pending'")
    .run(status, new Date().toISOString(), id);
  if (!result.changes) throw publicError("Pending candidate not found", 404);
  return { candidate_id: id, status, canonical_memory_written: false };
}

function normalize(text) { return text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ""); }
