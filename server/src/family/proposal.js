import { readFamily, familySnapshot } from "./service.js";

// This is a reviewable partition, not a lifecycle or content rewrite.
export function proposeFamilyGroups(db, input) {
  const family = readFamily(db, input);
  const snapshot = familySnapshot(db, family.family_key);
  const parent = new Map(family.members.map(member => [member.id, member.id]));
  const root = id => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current);
    return current;
  };
  const join = (left, right) => parent.set(root(right), root(left));
  const pairs = new Map();
  for (const judgment of family.judgments.filter(item => item.current)) {
    const key = JSON.stringify([judgment.left_id, judgment.right_id].sort());
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(judgment);
  }
  const issues = [];
  const evidence = [];
  for (const judgments of pairs.values()) {
    const first = judgments[0];
    if (new Set(judgments.map(item => item.relation)).size > 1 || first.relation === "unclear") {
      issues.push({ reason: "conflicting-or-unclear", memory_ids: [first.left_id, first.right_id] });
      continue;
    }
    evidence.push(first);
    if (first.relation === "revision") join(first.left_id, first.right_id);
  }
  for (const memory of snapshot.records) if (parent.has(memory.supersedes_id)) join(memory.supersedes_id, memory.id);
  for (const judgment of evidence) if (judgment.relation === "sequence" && root(judgment.left_id) === root(judgment.right_id)) {
    issues.push({ reason: "sequence-inside-revision-group", memory_ids: [judgment.left_id, judgment.right_id] });
  }
  const branches = new Map();
  for (const { id } of family.members) {
    const key = root(id);
    if (!branches.has(key)) branches.set(key, []);
    branches.get(key).push(id);
  }
  const groups = [...branches.values()].map(ids => ids.sort()).sort((a, b) => a[0].localeCompare(b[0]));
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
    if (!evidence.some(item => item.relation === "sequence"
      && ((groups[i].includes(item.left_id) && groups[j].includes(item.right_id))
        || (groups[j].includes(item.left_id) && groups[i].includes(item.right_id))))) {
      issues.push({ reason: "unexamined-groups", memory_ids: [groups[i][0], groups[j][0]] });
    }
  }
  const before = family.groups.map(item => [...item.memory_ids].sort()).sort((a, b) => a[0].localeCompare(b[0]));
  const changed = JSON.stringify(before) !== JSON.stringify(groups);
  return { family_key: family.family_key, expected_fingerprint: family.fingerprint,
    status: issues.length ? "needs_review" : changed ? "ready" : "unchanged",
    before, groups, changed, issues, evidence: evidence.map(({ id, left_id, right_id, relation }) => ({ id, left_id, right_id, relation })),
    ...(issues.length || !changed ? {} : { apply_request: {
      family_key: family.family_key, expected_fingerprint: family.fingerprint, groups,
    } }), canonical_memories_changed: false };
}
