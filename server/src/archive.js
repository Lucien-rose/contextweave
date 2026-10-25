import { listMemoriesForAdmin } from "./database.js";
import { publicCandidate, publicMemory } from "./admin/http.js";

// Owner-only export: retain canonical evidence and lifecycle records, not
// rebuildable FTS/vector indexes or deployment credentials.
const MEMORY_TABLES = [
  "memory_relations", "memory_evidence", "memory_source_refs",
  "source_materials", "source_material_focus", "observances", "audit_log",
  "evolution_policy", "memory_changes", "memory_reviews", "memory_deletions",
  "memory_change_relations",
  "memory_family_groups", "memory_family_judgments", "family_change_receipts",
  "memory_starfields",
  "entities", "memory_entities", "recall_settings",
  "relation_assertions", "relation_evidence", "relation_reviews",
  "portrait_subjects", "portrait_items", "portrait_evidence", "portrait_changes",
  "window_capsules", "doctor_batches", "health_runs", "health_findings",
  "portrait_runtime_settings", "portrait_observations", "portrait_jobs", "portrait_candidates",
];

export function buildMemoryArchive(db, memoryCore, continuityCore) {
  const memories = collectPages((page) => listMemoriesForAdmin(db, page));
  const candidates = collectPages((page) => memoryCore.candidates(page));
  return {
    exported_at: new Date().toISOString(),
    memories: memories.map((memory) => ({ ...publicMemory(memory), source_hash: memory.source_hash })),
    memory_gateway: { schema_version: 2, candidates: candidates.map(publicCandidate) },
    memory_state: {
      schema_version: 1,
      tables: Object.fromEntries(MEMORY_TABLES.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])),
    },
    arcs: {
      schema_version: 1,
      items: db.prepare("SELECT * FROM arcs ORDER BY created_at, id").all(),
      materials: db.prepare("SELECT * FROM arc_materials ORDER BY arc_id, position, attached_at, material_id").all(),
    },
    continuity: continuityCore.export(),
  };
}

function collectPages(list) {
  const limit = 250;
  const rows = [];
  for (let offset = 0; ; offset += limit) {
    const page = list({ status: "all", limit, offset });
    rows.push(...page);
    if (page.length < limit) return rows;
  }
}
