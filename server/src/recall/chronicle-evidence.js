export const CHRONICLE_EVIDENCE_SCHEMA = "chronicle-evidence-v1";

const HISTORICAL_SOURCE = /(?:historical|history|archive|archived|superseded|old|旧|历史)/i;
const AUTHORITATIVE_SOURCE = /(?:authoritative|verified|runtime|live|status|receipt|manifest|权威|已核验)/i;

export function sourceAuthorityForMemory(memory) {
  const file = String(memory.source_file || "");
  const section = String(memory.source_section || "");
  const complete = Boolean(file && section && memory.source_hash);
  const descriptor = `${file} ${section}`;
  const temporalScope = HISTORICAL_SOURCE.test(section) ? "historical" : "current-or-unspecified";
  const authoritative = complete && temporalScope !== "historical" && AUTHORITATIVE_SOURCE.test(descriptor);
  return Object.freeze({
    rank: authoritative ? 3 : complete ? 2 : 0,
    level: authoritative ? "authoritative" : complete ? "provenance-complete" : "unverified",
    reason: authoritative ? "verified-source-identity" : complete ? "complete-source-identity" : "missing-source-identity",
    integrity: complete ? "complete" : "incomplete",
    temporal_scope: temporalScope,
  });
}

export function chronicleEvidenceForMemory(memory) {
  const source = compact({
    file: memory.source_file,
    section: memory.source_section,
    external_id: memory.external_id,
    source_hash: memory.source_hash,
  });
  return Object.freeze({
    schema_version: CHRONICLE_EVIDENCE_SCHEMA,
    memory_id: memory.id,
    state: memory.status,
    family_key: memory.family_key,
    supersedes_id: memory.supersedes_id || null,
    sources: Object.freeze(Object.keys(source).length ? [Object.freeze(source)] : []),
  });
}

export function chronicleEvidenceTrace(memory) {
  const evidence = chronicleEvidenceForMemory(memory);
  const authority = sourceAuthorityForMemory(memory);
  return {
    chronicle_evidence_available: evidence.sources.length > 0,
    chronicle_evidence_ref_count: evidence.sources.length,
    chronicle_source_hash_present: Boolean(memory.source_hash),
    chronicle_lineage_present: Boolean(memory.supersedes_id),
    chronicle_source_integrity: authority.integrity,
    chronicle_authority_level: authority.level,
    chronicle_authority_reason: authority.reason,
    chronicle_temporal_scope: authority.temporal_scope,
  };
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== ""));
}
