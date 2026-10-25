import { hydrateMemory as hydrate } from "./database-record.js";

export function listMemoriesForAdmin(db, {
  status = "active",
  layer = "all",
  starfield = "all",
  kind = "all",
  sensitivity = "all",
  query = "",
  limit = 100,
  offset = 0,
} = {}) {
  const clauses = [];
  const params = [];
  if (starfield !== "all") {
    clauses.push("COALESCE((SELECT starfield FROM memory_starfields WHERE memory_id = memories.id), 'unnamed') = ?");
    params.push(starfield);
  }
  if (status !== "all") {
    clauses.push("status = ?");
    params.push(status);
  }
  if (layer !== "all") {
    clauses.push("layer = ?");
    params.push(layer);
  }
  if (kind !== "all") {
    if (kind === "memory") clauses.push("kind NOT IN ('quote', 'draft-quote', 'handoff', 'draft-handoff')");
    else if (kind === "quote") clauses.push("kind IN ('quote', 'draft-quote')");
    else if (kind === "handoff") clauses.push("kind IN ('handoff', 'draft-handoff')");
    else {
      clauses.push("kind = ?");
      params.push(kind);
    }
  }
  if (sensitivity !== "all") {
    clauses.push("sensitivity = ?");
    params.push(sensitivity);
  }
  const normalizedQuery = String(query || "").trim();
  if (normalizedQuery) {
    clauses.push("(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\' OR triggers_json LIKE ? ESCAPE '\\')");
    const pattern = `%${escapeLike(normalizedQuery)}%`;
    params.push(pattern, pattern, pattern, pattern);
  }
  const safeLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`
    SELECT memories.*,
      COALESCE((SELECT starfield FROM memory_starfields WHERE memory_id = memories.id), 'unnamed') AS starfield,
      (SELECT COUNT(*) FROM memory_evidence WHERE memory_id = memories.id) AS source_count
    FROM memories
    ${where}
    ORDER BY
      CASE status WHEN 'draft' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
      importance DESC,
      COALESCE(event_date, updated_at) DESC,
      updated_at DESC, id
    LIMIT ? OFFSET ?
  `).all(...params, safeLimit, safeOffset).map(hydrate);
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (character) => `\\${character}`);
}
