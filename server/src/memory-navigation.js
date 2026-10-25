import { privateArcVisible } from "./arc/materials.js";

export function cardArcMemberships(db, memories, { context, intimacyMode }) {
  const index = new Map();
  if (!memories.length || !["private", "intimate"].includes(context)) return index;
  const ids = memories.map((memory) => memory.id);
  const families = [...new Set(memories.map((memory) => memory.family_key).filter(Boolean))];
  const placeholders = (values) => values.map(() => "?").join(",");
  const rows = db.prepare(`SELECT a.id, a.title, a.sensitivity, m.material_type, m.material_id, m.chapter
    FROM arc_materials m JOIN arcs a ON a.id = m.arc_id
    WHERE a.status = 'active' AND ((m.material_type = 'memory' AND m.material_id IN (${placeholders(ids)}))
      ${families.length ? "OR (m.material_type = 'family' AND m.material_id IN (" + placeholders(families) + "))" : ""})
    ORDER BY a.id, m.position, m.attached_at LIMIT 512`).all(...ids, ...families);
  for (const row of rows) {
    if (!privateArcVisible(row.sensitivity, { context, intimacy_mode: intimacyMode })) continue;
    const key = row.material_type + ":" + row.material_id;
    const entries = index.get(key) || [];
    if (entries.length < 4) entries.push({ id: row.id, title: row.title, chapter: row.chapter });
    index.set(key, entries);
  }
  return index;
}

export function membershipsFor(memory, index) {
  if (memory.public_projection_only) return [];
  return [...new Map([...(index.get("memory:" + memory.id) || []),
    ...(index.get("family:" + memory.family_key) || [])].map((arc) => [arc.id, arc])).values()].slice(0, 4);
}

