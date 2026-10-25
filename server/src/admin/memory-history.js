import { readFamily } from "../family/service.js";
import { memoryBranchKey } from "../family/groups.js";
import { readLifecycleState } from "../memory-lifecycle.js";
import { publicMemory } from "./http.js";

// Owner-only read model. Lifecycle and grouping remain owned by their services;
// the UI receives headers for navigation and the selected record's full text.
export function readMemoryHistory(db, memoryCore, memoryId) {
  const timeline = memoryCore.timeline(memoryId);
  if (!timeline) return null;
  const selected = timeline.entries.find(({ id }) => id === memoryId);
  const family = readFamily(db, { family_key: selected.family_key });
  const branches = new Map();
  const entries = timeline.entries.map((memory) => {
    const branchKey = memoryBranchKey(db, memory);
    if (!branches.has(branchKey)) branches.set(branchKey, []);
    branches.get(branchKey).push(memory.id);
    return historyCard(memory, branchKey);
  });
  const ids = new Set(entries.map(({ id }) => id));
  const relations = db.prepare(`SELECT r.source_id, r.target_id, r.relation
    FROM memory_relations r JOIN memories m ON m.id = r.source_id
    WHERE m.family_key = ? ORDER BY r.source_id, r.target_id, r.relation`)
    .all(selected.family_key).filter((row) => ids.has(row.source_id) && ids.has(row.target_id));
  for (const entry of entries) {
    if (entry.supersedes_id && ids.has(entry.supersedes_id)) {
      relations.push({ source_id: entry.id, target_id: entry.supersedes_id, relation: "supersedes" });
    }
  }
  return {
    projection_mode: "read-only",
    memory: publicMemory(selected),
    selected_branch_key: memoryBranchKey(db, selected),
    family_key: selected.family_key,
    entries,
    branches: [...branches].map(([branch_key, memory_ids]) => {
      const state = readLifecycleState(db, { memoryId: memory_ids[0], branchKey: branch_key });
      return { branch_key, memory_ids, dimension: state.dimension, conflict: state.conflict,
        states: state.state_history.map(({ value, evidence, ...header }) => header),
        current_memory_ids: state.current_states.flatMap((item) => item.active_memory_ids) };
    }),
    relations,
    changes: db.prepare(`SELECT id AS change_id, memory_id, target_id, operation, status, created_at
      FROM memory_changes WHERE family_key = ? ORDER BY created_at, rowid`).all(selected.family_key),
    judgments: family.judgments,
  };
}

function historyCard(memory, branchKey) {
  return {
    id: memory.id, title: memory.title, kind: memory.kind, family_key: memory.family_key,
    branch_key: branchKey, status: memory.status, version: memory.version,
    content_hash: memory.content_hash, supersedes_id: memory.supersedes_id,
    summary: memory.recall_summary || memory.content.slice(0, 240),
    timeline: memory.timeline, evidence_count: memory.evidence.length,
  };
}
