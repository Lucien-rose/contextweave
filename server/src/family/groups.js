// Grouping controls duplicate selection only. It never rewrites lifecycle state.
export function readFamilyGroups(db) {
  return new Map(db.prepare(`SELECT g.memory_id, g.branch_key FROM memory_family_groups g
    JOIN memories m ON m.id = g.memory_id WHERE m.family_key = g.family_key`)
    .all().map((row) => [row.memory_id, row.branch_key]));
}

export function assignFamilyBranch(db, memory, branchKey, origin) {
  db.prepare(`INSERT INTO memory_family_groups VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET family_key = excluded.family_key,
      branch_key = excluded.branch_key, origin = excluded.origin, updated_at = excluded.updated_at`)
    .run(memory.id, memory.family_key, branchKey, origin, new Date().toISOString());
}

export function inheritFamilyBranch(db, memory, target = null, { distinct = false } = {}) {
  if (memory.id === target?.id) return;
  const key = distinct ? `branch:${memory.id}` : target ? memoryBranchKey(db, target) : memory.family_key;
  assignFamilyBranch(db, memory, key, "host-intent");
}

export function memoryBranchKey(db, memory) {
  return db.prepare(`SELECT branch_key FROM memory_family_groups WHERE memory_id = ? AND family_key = ?`)
    .get(memory.id, memory.family_key)?.branch_key || memory.family_key;
}
