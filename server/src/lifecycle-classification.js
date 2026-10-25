const BELIEF_KINDS = new Set(["ambient", "preference", "profile", "style"]);
const EPISODE_KINDS = new Set(["episode", "event", "handoff"]);
const PROTECTED_KINDS = new Set(["agreement", "anchor", "intimate-agreement", "promise"]);
const DECLARED_PROVENANCE_RULES = [
  {
    id: "gateway-project-milestone",
    lifecycle_class: "episode",
    match: {
      kind: "context-memory",
      source_section: "gateway:project-milestone",
    },
  },
];

export function classifyLifecycleMemory(memory) {
  if (memory.standing_opt_in || PROTECTED_KINDS.has(memory.kind)) return "protected";
  if (BELIEF_KINDS.has(memory.kind)) return "belief";
  if (EPISODE_KINDS.has(memory.kind)) return "episode";
  const declared = DECLARED_PROVENANCE_RULES.find((rule) => matchesRule(memory, rule));
  if (declared) return declared.lifecycle_class;
  return "unclassified";
}

export function classifyLifecycleFamily(memories) {
  const categories = new Set(memories.map(classifyLifecycleMemory));
  if (categories.has("protected")) return "protected";
  if (categories.size === 1) return categories.values().next().value;
  if (categories.has("belief")) return "belief";
  if (categories.has("episode")) return "episode";
  return "unclassified";
}

export function groupLifecycleMemories(memories) {
  const families = new Map();
  for (const memory of memories) {
    const key = memory.family_key || `memory:${memory.id}`;
    const family = families.get(key) || [];
    family.push(memory);
    families.set(key, family);
  }
  return families;
}

export function auditLifecycleClassification(db) {
  const memories = db.prepare(`
    SELECT id, family_key, kind, layer, status, source_file, source_section,
           standing_opt_in
    FROM memories
    WHERE status IN ('active', 'archived', 'superseded')
  `).all();
  const families = groupLifecycleMemories(memories);
  const unclassified = [...families.entries()]
    .filter(([, family]) => classifyLifecycleFamily(family) === "unclassified");

  return {
    schema_version: 1,
    projection_mode: "read-only",
    grouping_contract: "family_key",
    unclassified_family_count: unclassified.length,
    unclassified_memory_count: unclassified.reduce((sum, [, family]) => sum + family.length, 0),
    family_size_distribution: familySizeDistribution(unclassified),
    metadata_groups: metadataGroups(unclassified),
    classified_family_representatives: classifiedFamilyRepresentatives(families),
    declaration_contract: {
      lifecycle_classes: ["belief", "episode", "protected", "unclassified"],
      stable_inputs: ["kind", "standing_opt_in", "declared_provenance"],
      review_inputs: ["layer", "status", "source_file", "source_section", "family_size"],
      provenance_rules: DECLARED_PROVENANCE_RULES,
      body_inference: false,
    },
    note: "This report contains metadata and identifiers only. Memory titles and bodies are not inspected or returned.",
  };
}

function matchesRule(memory, rule) {
  return Object.entries(rule.match).every(([key, value]) => memory[key] === value);
}

function classifiedFamilyRepresentatives(families) {
  const representatives = { belief: [], episode: [], protected: [] };
  for (const [familyKey, family] of families) {
    const lifecycleClass = classifyLifecycleFamily(family);
    if (lifecycleClass === "unclassified") continue;
    const memoryId = family.map((memory) => memory.id).sort()[0];
    representatives[lifecycleClass].push({ family_key: familyKey, memory_id: memoryId });
  }

  return Object.fromEntries(Object.entries(representatives).map(([lifecycleClass, items]) => [
    lifecycleClass,
    items.sort((left, right) => left.family_key.localeCompare(right.family_key)).slice(0, 3),
  ]));
}

function metadataGroups(unclassifiedFamilies) {
  const groups = new Map();
  for (const [familyKey, family] of unclassifiedFamilies) {
    for (const memory of family) {
      const metadata = {
        kind: memory.kind || null,
        layer: memory.layer || null,
        status: memory.status || null,
        source_file: memory.source_file || null,
        source_section: memory.source_section || null,
        standing_opt_in: Boolean(memory.standing_opt_in),
      };
      const key = JSON.stringify(metadata);
      const group = groups.get(key) || {
        metadata,
        memory_count: 0,
        family_keys: new Set(),
        representative_memory_ids: [],
      };
      group.memory_count += 1;
      group.family_keys.add(familyKey);
      if (group.representative_memory_ids.length < 3) {
        group.representative_memory_ids.push(memory.id);
      }
      groups.set(key, group);
    }
  }

  return [...groups.values()]
    .map((group) => ({
      metadata: group.metadata,
      memory_count: group.memory_count,
      family_count: group.family_keys.size,
      representative_family_keys: [...group.family_keys].sort().slice(0, 3),
      representative_memory_ids: group.representative_memory_ids.sort(),
    }))
    .sort((left, right) => right.family_count - left.family_count
      || right.memory_count - left.memory_count
      || metadataKey(left.metadata).localeCompare(metadataKey(right.metadata)));
}

function familySizeDistribution(unclassifiedFamilies) {
  const counts = new Map();
  for (const [, family] of unclassifiedFamilies) {
    counts.set(family.length, (counts.get(family.length) || 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([records_per_family, family_count]) => ({ records_per_family, family_count }));
}

function metadataKey(metadata) {
  return [
    metadata.kind,
    metadata.layer,
    metadata.status,
    metadata.source_file,
    metadata.source_section,
    metadata.standing_opt_in,
  ].map((value) => String(value ?? "")).join("|");
}
