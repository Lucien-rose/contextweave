import { buildFtsShadowMatch, searchProjectionText } from "./search-projection.js";
import {
  buildMemorySituationProjection,
  buildSituationMatch,
  compareSituationCandidates,
  projectionColumns,
  scoreSituationCandidates,
} from "./situation-projection.js";

export function refreshFts(db, id) {
  db.prepare("DELETE FROM memories_fts WHERE memory_id = ?").run(id);
  db.prepare(`
    INSERT INTO memories_fts(memory_id, title, content, tags, triggers)
    SELECT id, title, content, tags_json, triggers_json FROM memories WHERE id = ?
  `).run(id);
  db.prepare("DELETE FROM memories_fts_shadow WHERE memory_id = ?").run(id);
  const row = db.prepare(`
    SELECT id, title, content, tags_json, triggers_json FROM memories WHERE id = ?
  `).get(id);
  if (row) {
    insertFtsShadowRow(db.prepare(`
      INSERT INTO memories_fts_shadow(memory_id, title, content, tags, triggers)
      VALUES (?, ?, ?, ?, ?)
    `), row);
  }
  db.prepare("DELETE FROM memories_situation_shadow_v2 WHERE memory_id = ?").run(id);
  const situationRow = db.prepare(`
    SELECT id, title, content, tags_json, triggers_json, ambient_triggers_json
    FROM memories WHERE id = ?
  `).get(id);
  if (situationRow) {
    insertSituationShadowRow(db.prepare(`
      INSERT INTO memories_situation_shadow_v2(
        memory_id, title, body, metadata, ambient
      ) VALUES (?, ?, ?, ?, ?)
    `), situationRow);
  }
}

export function insertFtsShadowRow(statement, row) {
  statement.run(
    row.id,
    searchProjectionText(row.title),
    searchProjectionText(row.content),
    searchProjectionText(row.tags_json),
    searchProjectionText(row.triggers_json),
  );
}

export function insertSituationShadowRow(statement, row) {
  const projection = buildMemorySituationProjection(row);
  statement.run(row.id, ...projectionColumns(projection));
}

export function searchMemoriesFtsShadow(db, values, { limit = 24 } = {}) {
  const { expression, termCount, queryFocus } = buildFtsShadowMatch(values);
  if (!expression) {
    return { items: [], query_count: 0, term_count: 0, query_focus: queryFocus, degraded: false, reason: null };
  }
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 24));
  try {
    const items = db.prepare(`
      SELECT f.memory_id, bm25(memories_fts_shadow, 0, 3, 1, 2, 2) AS rank
      FROM memories_fts_shadow f
      JOIN memories m ON m.id = f.memory_id AND m.status = 'active'
      WHERE memories_fts_shadow MATCH ?
      ORDER BY rank ASC, f.memory_id ASC
      LIMIT ?
    `).all(expression, safeLimit).map((item, index) => ({
      id: item.memory_id,
      rank: index + 1,
    }));
    return { items, query_count: 1, term_count: termCount, query_focus: queryFocus, degraded: false, reason: null };
  } catch {
    return { items: [], query_count: 1, term_count: termCount, query_focus: queryFocus, degraded: true, reason: "fts-shadow-query-failed" };
  }
}

export function searchMemoriesSituationShadow(db, values, { limit = 24, ignoreSemanticGuard = false } = {}) {
  const query = buildSituationMatch(values, { ignoreSemanticGuard });
  if (!query.expression) {
    return {
      items: [], query_count: 0, concept_count: query.tokens.length,
      blocked: query.blocked, degraded: false, reason: query.reason,
    };
  }
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 24));
  try {
    const rows = db.prepare(`
      SELECT f.memory_id, f.title, f.body, f.metadata, f.ambient,
             bm25(memories_situation_shadow_v2, 0, 3, 1.5, 2.25, 2) AS lexical_rank
      FROM memories_situation_shadow_v2 f
      JOIN memories m ON m.id = f.memory_id AND m.status = 'active'
      WHERE memories_situation_shadow_v2 MATCH ?
      ORDER BY lexical_rank ASC, f.memory_id ASC
      LIMIT ?
    `).all(query.expression, safeLimit);
    const items = scoreSituationCandidates(query, rows)
      .sort(compareSituationCandidates)
      .map((item, index) => ({ ...item, rank: index + 1 }));
    return {
      items, query_count: 1, concept_count: query.tokens.length,
      blocked: false, degraded: false, reason: null,
    };
  } catch {
    return {
      items: [], query_count: 1, concept_count: query.tokens.length,
      blocked: false, degraded: true, reason: "situation-shadow-query-failed",
    };
  }
}
