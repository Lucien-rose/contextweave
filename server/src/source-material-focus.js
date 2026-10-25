import { safeJsonArray } from "./lib/json.js";
import { readSourceMaterial } from "./source-materials.js";

const MAX_FOCUS_RANGES = 40;

export function readSourceMaterialFocus(db, materialId, material = null) {
  const source = material || readSourceMaterial(db, materialId);
  if (!source) return null;
  const row = db.prepare(`
    SELECT ranges_json, updated_by, updated_at
    FROM source_material_focus WHERE material_id = ?
  `).get(materialId);
  if (!row) return emptyFocus(source);
  const ranges = normalizeRanges(safeJsonArray(row.ranges_json), source.content.length);
  return {
    material_id: materialId,
    ranges,
    content: focusedContent(source.content, ranges),
    updated_by: row.updated_by,
    updated_at: row.updated_at,
  };
}

export function setSourceMaterialFocus(db, {
  materialId,
  expectedSourceHash,
  ranges = [],
  excerpts = [],
  updatedBy,
}) {
  const material = readSourceMaterial(db, materialId);
  if (!material) throw new TypeError(`Source material not found: ${materialId}`);
  if (material.content_hash !== expectedSourceHash) {
    throw new TypeError("Source material changed; reopen the original context before saving focus");
  }
  const selected = excerpts.length
    ? rangesForExcerpts(material.content, excerpts)
    : normalizeRanges(ranges, material.content.length);
  if (!selected.length) {
    db.prepare("DELETE FROM source_material_focus WHERE material_id = ?").run(materialId);
    return emptyFocus(material);
  }
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO source_material_focus(material_id, ranges_json, updated_by, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(material_id) DO UPDATE SET
      ranges_json = excluded.ranges_json,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(materialId, JSON.stringify(selected), cleanActor(updatedBy), now);
  return readSourceMaterialFocus(db, materialId, material);
}

function rangesForExcerpts(content, excerpts) {
  const ranges = [];
  for (const rawExcerpt of excerpts.slice(0, MAX_FOCUS_RANGES)) {
    const excerpt = String(rawExcerpt || "");
    if (!excerpt) continue;
    const start = content.indexOf(excerpt);
    if (start === -1) throw new TypeError("A selected excerpt no longer matches the stored source material");
    ranges.push({ start, end: start + excerpt.length });
  }
  return normalizeRanges(ranges, content.length);
}

function normalizeRanges(value, contentLength) {
  const ranges = [];
  for (const item of Array.isArray(value) ? value.slice(0, MAX_FOCUS_RANGES) : []) {
    const start = Number(item?.start);
    const end = Number(item?.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > contentLength) {
      throw new TypeError("Source focus ranges must point inside the immutable source material");
    }
    ranges.push({ start, end });
  }
  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function focusedContent(content, ranges) {
  return ranges.map(({ start, end }) => content.slice(start, end).trim()).filter(Boolean).join("\n…\n");
}

function emptyFocus(material) {
  return {
    material_id: material.id,
    ranges: [],
    content: null,
    updated_by: null,
    updated_at: null,
  };
}

function cleanActor(value) {
  const actor = String(value || "shared").trim();
  return actor.slice(0, 80) || "shared";
}
