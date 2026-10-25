import { safeJsonObject } from "./lib/json.js";
import { readSourceMaterial, recordSourceMaterial } from "./source-materials.js";

export function appendMemoryEvidence(db, memoryId, sourceRefs) {
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) return listMemoryEvidence(db, memoryId);
  const insert = db.prepare(`
    INSERT INTO memory_evidence (
      memory_id, source_type, source_id, excerpt, occurred_at,
      metadata_json, material_id, source_hash, written_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(memory_id, source_type, source_id) DO UPDATE SET
      excerpt = COALESCE(memory_evidence.excerpt, excluded.excerpt),
      occurred_at = COALESCE(memory_evidence.occurred_at, excluded.occurred_at),
      metadata_json = CASE
        WHEN memory_evidence.metadata_json = '{}' THEN excluded.metadata_json
        ELSE memory_evidence.metadata_json
      END,
      material_id = COALESCE(memory_evidence.material_id, excluded.material_id),
      source_hash = COALESCE(memory_evidence.source_hash, excluded.source_hash),
      written_at = COALESCE(memory_evidence.written_at, excluded.written_at)
  `);
  const now = new Date().toISOString();
  for (const source of sourceRefs) {
    const material = source.material_id
      ? readSourceMaterial(db, source.material_id)
      : recordSourceMaterial(db, source);
    insert.run(
      memoryId,
      String(source.source_type || "unknown"),
      String(source.source_id || "unknown"),
      source.excerpt || null,
      source.occurred_at || null,
      JSON.stringify(source.metadata || {}),
      material?.id || source.material_id || null,
      source.source_hash || material?.content_hash || null,
      source.written_at || material?.written_at || null,
      now,
    );
  }
  return listMemoryEvidence(db, memoryId);
}

export function listMemoryEvidence(db, memoryId) {
  return db.prepare(`
    SELECT source_type, source_id, excerpt, occurred_at, metadata_json,
           material_id, source_hash, written_at, created_at
    FROM memory_evidence
    WHERE memory_id = ?
    ORDER BY COALESCE(occurred_at, created_at), id
  `).all(memoryId).map((row) => {
    const material = row.material_id ? readSourceMaterial(db, row.material_id) : null;
    const metadata = safeJsonObject(row.metadata_json);
    const integrity = integrityFor(row, material);
    return {
      source_type: row.source_type,
      source_id: row.source_id,
      excerpt: row.excerpt,
      occurred_at: row.occurred_at,
      written_at: row.written_at,
      source_hash: row.source_hash,
      material_id: row.material_id,
      source_integrity: integrity,
      source_authority: String(metadata.authority || "unverified"),
      coverage: material ? "context" : row.excerpt ? "excerpt" : "identity",
      backfill_state: material ? "complete" : "pending",
      context_available: Boolean(material),
      speaker: material?.speaker || metadata.speaker || null,
      content_version: material?.content_version || null,
      metadata,
      recorded_at: row.created_at,
    };
  });
}

export function withMemoryEvidence(db, memory) {
  const evidence = listMemoryEvidence(db, memory.id);
  return {
    ...memory,
    evidence,
    timeline: {
      event_time: memory.event_date || evidence.find((item) => item.occurred_at)?.occurred_at || null,
      written_at: memory.created_at,
      updated_at: memory.updated_at,
    },
  };
}

function integrityFor(evidence, material) {
  if (material && evidence.source_hash === material.content_hash) return "complete";
  if (material) return "hash-unverified";
  if (evidence.source_type === "unknown" || evidence.source_id === "unknown") return "incomplete";
  return evidence.excerpt ? "partial" : "referenced";
}
