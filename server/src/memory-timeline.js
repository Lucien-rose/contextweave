export function readMemoryTimeline(db, memoryId, readMemory) {
  const anchor = readMemory(memoryId);
  if (!anchor) return null;
  const rows = db.prepare(`
    WITH RECURSIVE lineage(id) AS (
      SELECT ?
      UNION
      SELECT m.supersedes_id
      FROM memories m
      JOIN lineage l ON m.id = l.id
      WHERE m.supersedes_id IS NOT NULL
      UNION
      SELECT m.id
      FROM memories m
      JOIN lineage l ON m.supersedes_id = l.id
    )
    SELECT DISTINCT m.id
    FROM memories m
    WHERE m.id IN (SELECT id FROM lineage)
       OR m.family_key = ?
    ORDER BY COALESCE(m.event_date, m.created_at), m.version, m.created_at, m.id
  `).all(memoryId, anchor.family_key);
  return {
    family_key: anchor.family_key,
    entries: rows.map((row) => readMemory(row.id)),
  };
}
