import { defaults } from "../defaults.js";
import { compactRecallCue } from "./packing.js";
import { publicError } from "../lib/error.js";

export const DEFAULT_RETURN_BUDGET = defaults.totalChars;

export function returnBudget(value = DEFAULT_RETURN_BUDGET) {
  if (!Number.isInteger(value) || value < 2048 || value > 24000) {
    throw publicError("total_budget_chars must be an integer between 2048 and 24000");
  }
  return value;
}

export function serializedChars(value) {
  return JSON.stringify(value).length;
}

// The count includes its own digits in the serialized payload.
export function updateCharacterCount(payload) {
  let size = serializedChars(payload);
  while (payload.budgets.total_characters !== size) {
    payload.budgets.total_characters = size;
    size = serializedChars(payload);
  }
}

// Each section is ordered by priority. Whole entries are omitted, never silently
// clipped; an omitted original remains available through its read/expand API.
export function fitSections(payload, paths, limit) {
  const seenIds = new Set();
  const seenHashes = new Set();
  const sections = paths.map((path) => {
    const target = path.slice(0, -1).reduce((value, key) => value[key], payload);
    const key = path.at(-1);
    const entries = target[key];
    target[key] = [];
    return { target, key, entries };
  });
  let omitted = 0;
  for (const { target, key, entries } of sections) {
    for (const item of entries) {
      if ((item.id && seenIds.has(item.id)) || (item.content_hash && seenHashes.has(item.content_hash))) {
        omitted += 1;
        continue;
      }
      target[key].push(item);
      if (serializedChars(payload) > limit) {
        target[key].pop();
        omitted += 1;
        continue;
      }
      if (item.id) seenIds.add(item.id);
      if (item.content_hash) seenHashes.add(item.content_hash);
    }
  }
  return omitted;
}

export function boundRecallLanes(main, background, { limit = DEFAULT_RETURN_BUDGET, query = "" } = {}) {
  const total = returnBudget(limit);
  const payload = { memories: [], background_memories: [] };
  const ids = new Set();
  const hashes = new Set();
  const kept = { main: [], background: [] };
  const dropped = [];
  const overhead = 1200 + Math.min(query.length, 256) + serializedChars(main.map((item) => item.presentation.id));
  const itemBudget = Math.max(128, total - overhead);
  for (const [lane, entries, key] of [["main", main, "memories"], ["background", background, "background_memories"]]) {
    for (const item of entries) {
      const { id, content_hash: hash } = item.presentation;
      if (ids.has(id) || (hash && hashes.has(hash))) {
        dropped.push(id);
        continue;
      }
      const compact = compactRecallCue(item.presentation, { excerptLimit: item.entry.recallTier === "T0" ? 360 : 120 });
      payload[key].push(compact);
      if (serializedChars(payload) > itemBudget) {
        payload[key].pop();
        dropped.push(id);
        continue;
      }
      kept[lane].push({ ...item, presentation: compact, original: item.presentation });
      ids.add(id);
      if (hash) hashes.add(hash);
    }
  }
  for (const [lane, key] of [["main", "memories"], ["background", "background_memories"]]) {
    for (const [index, item] of kept[lane].entries()) {
      payload[key][index] = item.original;
      if (serializedChars(payload) <= itemBudget) item.presentation = item.original;
      else payload[key][index] = item.presentation;
      delete item.original;
    }
  }
  return { ...kept, dropped, limit: total, used: serializedChars(payload), reserved: total - itemBudget };
}

