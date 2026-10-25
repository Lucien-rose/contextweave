import { listMemoryEvidence } from "./memory-evidence.js";
import {
  classifyLifecycleFamily,
  classifyLifecycleMemory,
  groupLifecycleMemories,
} from "./lifecycle-classification.js";
import { areAllMemoriesCoexisting } from "./memory-relations.js";

export function readLifecycleState(db, { memoryId, branchKey = null }) {
  const selected = db.prepare(`
    SELECT id, family_key
    FROM memories
    WHERE id = ?
      AND status IN ('active', 'paused', 'archived', 'superseded', 'draft')
  `).get(memoryId);
  if (!selected) return null;

  const dimensionKey = selected.family_key || `memory:${selected.id}`;
  const memories = db.prepare(`
    SELECT *
    FROM memories
    WHERE COALESCE(family_key, 'memory:' || id) = ?
      AND status IN ('active', 'archived', 'superseded')
      AND (? IS NULL OR COALESCE((SELECT branch_key FROM memory_family_groups g
        WHERE g.memory_id = memories.id AND g.family_key = memories.family_key), family_key) = ?)
    ORDER BY COALESCE(event_date, created_at), version, id
  `).all(dimensionKey, branchKey, branchKey);

  return projectFamily(db, dimensionKey, memories);
}

// Recall needs category and validity, not dates, bodies or evidence history.
export function readLifecycleAuthorities(db) {
  const memories = db.prepare(`
    SELECT id, family_key, kind, status, source_section, standing_opt_in, content_hash
    FROM memories WHERE status IN ('active', 'archived', 'superseded')
  `).all();
  return new Map([...groupLifecycleMemories(memories)].map(([key, family]) => {
    const category = classifyLifecycleFamily(family);
    const states = category === "belief"
      ? [...groupBy(family, valueKey).values()].map((records) => ({
        memory_ids: records.map(({ id }) => id),
        active_memory_ids: records.filter(({ status }) => status === "active").map(({ id }) => id),
      })) : [];
    assignStateValidity(db, states);
    return [key, { dimension: { category }, state_history: states }];
  }));
}

export function auditMemoryLifecycle(db) {
  const memories = db.prepare(`
    SELECT id, family_key, kind, layer, status, source_section,
           standing_opt_in, content_hash
    FROM memories
    WHERE status IN ('active', 'archived', 'superseded')
  `).all();
  const families = groupLifecycleMemories(memories);
  const categories = { belief: 0, episode: 0, protected: 0, unclassified: 0 };
  let disputedFamilies = 0;
  let multiRecordFamilies = 0;

  for (const family of families.values()) {
    categories[classifyLifecycleFamily(family)] += 1;
    if (family.length > 1) multiRecordFamilies += 1;
    const activeValues = new Set(
      family.filter((memory) => memory.status === "active").map(valueKey),
    );
    const activeIds = family.filter((memory) => memory.status === "active").map((memory) => memory.id);
    if (activeValues.size > 1 && !areAllMemoriesCoexisting(db, activeIds)) disputedFamilies += 1;
  }

  return {
    schema_version: 1,
    projection_mode: "read-only",
    grouping_contract: "family_key",
    memory_count: memories.length,
    family_count: families.size,
    categories,
    multi_record_families: multiRecordFamilies,
    disputed_families: disputedFamilies,
    unclassified_memories: memories.filter((memory) => classifyLifecycleMemory(memory) === "unclassified").length,
    note: "Unclassified memories remain untouched until their lifecycle meaning is declared explicitly.",
  };
}

function projectFamily(db, dimensionKey, memories) {
  const category = classifyLifecycleFamily(memories);
  const retention = retentionPolicy(memories, category);
  const states = [...groupBy(memories, valueKey).values()]
    .map((records) => projectState(db, records))
    .sort(compareStates);
  const { activeStates, coexisting, disputed } = assignStateValidity(db, states);

  const currentState = activeStates.length === 1 ? activeStates[0] : null;
  return {
    schema_version: 1,
    projection_mode: "read-only",
    dimension: {
      key: dimensionKey,
      category,
      retention,
      maturity: currentState && currentState.support_count > 1 ? "established" : "candidate",
    },
    current_state: currentState,
    current_states: activeStates,
    state_history: states,
    conflict: {
      status: disputed ? "disputed" : (coexisting ? "coexisting" : "clear"),
      active_state_count: activeStates.length,
      candidate_state_keys: disputed ? activeStates.map((state) => state.value_key) : [],
    },
    authority_inputs: currentState ? {
      validity: currentState.validity,
      first_seen: currentState.first_seen,
      last_confirmed: currentState.last_confirmed,
      support_count: currentState.support_count,
      conflict_state: disputed ? "disputed" : (coexisting ? "coexisting" : "clear"),
    } : null,
    mutation: {
      canonical_memories_changed: false,
      automatic_merge: false,
      automatic_supersede: false,
      automatic_delete: false,
    },
  };
}

function assignStateValidity(db, states) {
  const activeStates = states.filter((state) => state.active_memory_ids.length > 0);
  const activeIds = activeStates.flatMap((state) => state.active_memory_ids);
  const coexisting = activeStates.length > 1 && areAllMemoriesCoexisting(db, activeIds);
  const disputed = activeStates.length > 1 && !coexisting;
  for (const state of states) {
    state.validity = !state.active_memory_ids.length ? "historical"
      : disputed ? "disputed" : coexisting ? "coexisting" : "current";
  }
  return { activeStates, coexisting, disputed };
}

function projectState(db, records) {
  const ordered = [...records].sort(compareMemories);
  const latest = ordered.at(-1);
  const evidence = ordered.flatMap((memory) => evidenceForMemory(db, memory));
  const activeMemoryIds = ordered
    .filter((memory) => memory.status === "active")
    .map((memory) => memory.id);

  return {
    value_key: valueKey(latest),
    title: latest.title,
    value: latest.content,
    validity: "historical",
    first_seen: earliest(evidence.map((item) => item.occurred_at)) || effectiveTime(ordered[0]),
    last_confirmed: latestTime(evidence.map((item) => item.occurred_at)) || effectiveTime(latest),
    support_count: evidence.length,
    memory_ids: ordered.map((memory) => memory.id),
    active_memory_ids: activeMemoryIds,
    evidence,
  };
}

function evidenceForMemory(db, memory) {
  const recorded = listMemoryEvidence(db, memory.id);
  if (recorded.length > 0) {
    return recorded.map((evidence) => ({
      memory_id: memory.id,
      relation: "supporting",
      source_type: evidence.source_type,
      source_id: evidence.source_id,
      occurred_at: evidence.occurred_at || evidence.recorded_at,
      excerpt: evidence.excerpt,
    }));
  }
  return [{
    memory_id: memory.id,
    relation: "supporting",
    source_type: "memory_record",
    source_id: memory.id,
    occurred_at: effectiveTime(memory),
    excerpt: null,
  }];
}

function retentionPolicy(memories, category) {
  if (category === "protected") return "anchor";
  return memories.some((memory) => memory.layer === "core") ? "durable" : "normal";
}

function valueKey(memory) {
  return memory.content_hash || `memory:${memory.id}`;
}

function effectiveTime(memory) {
  return memory.event_date || memory.created_at || memory.updated_at || null;
}

function compareMemories(left, right) {
  return compareTimes(effectiveTime(left), effectiveTime(right))
    || Number(left.version || 1) - Number(right.version || 1)
    || left.id.localeCompare(right.id);
}

function compareStates(left, right) {
  return compareTimes(left.first_seen, right.first_seen)
    || left.value_key.localeCompare(right.value_key);
}

function compareTimes(left, right) {
  return timeValue(left) - timeValue(right);
}

function earliest(values) {
  return values.filter(Boolean).sort(compareTimes).at(0) || null;
}

function latestTime(values) {
  return values.filter(Boolean).sort(compareTimes).at(-1) || null;
}

function timeValue(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function groupBy(items, keyFor) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}
