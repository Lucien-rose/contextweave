const COEXISTENCE = "coexists_with";

export function relateMemories(db, {
  sourceId,
  targetId,
  relation,
  changeId = null,
  symmetric = false,
}) {
  const pairs = symmetric
    ? [[sourceId, targetId], [targetId, sourceId]]
    : [[sourceId, targetId]];

  for (const [source, target] of pairs) {
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO memory_relations (source_id, target_id, relation, weight)
      VALUES (?, ?, ?, 1)
    `).run(source, target, relation);
    if (changeId && inserted.changes) {
      db.prepare(`
        INSERT INTO memory_change_relations (change_id, source_id, target_id, relation)
        VALUES (?, ?, ?, ?)
      `).run(changeId, source, target, relation);
    }
  }
}

export function relateCoexistingMemories(db, leftId, rightId, changeId) {
  relateMemories(db, {
    sourceId: leftId,
    targetId: rightId,
    relation: COEXISTENCE,
    changeId,
    symmetric: true,
  });
}

export function areMemoriesCoexisting(db, leftId, rightId) {
  if (leftId === rightId) return true;
  return Boolean(db.prepare(`
    SELECT 1
    FROM memory_relations
    WHERE relation = ?
      AND ((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?))
    LIMIT 1
  `).get(COEXISTENCE, leftId, rightId, rightId, leftId));
}

export function areAllMemoriesCoexisting(db, memoryIds) {
  for (let left = 0; left < memoryIds.length; left += 1) {
    for (let right = left + 1; right < memoryIds.length; right += 1) {
      if (!areMemoriesCoexisting(db, memoryIds[left], memoryIds[right])) return false;
    }
  }
  return true;
}

export function removeRelationsForChange(db, changeId) {
  const relations = db.prepare(`
    SELECT source_id, target_id, relation
    FROM memory_change_relations
    WHERE change_id = ?
  `).all(changeId);
  for (const relation of relations) {
    db.prepare(`
      DELETE FROM memory_relations
      WHERE source_id = ? AND target_id = ? AND relation = ?
    `).run(relation.source_id, relation.target_id, relation.relation);
  }
  db.prepare("DELETE FROM memory_change_relations WHERE change_id = ?").run(changeId);
}
