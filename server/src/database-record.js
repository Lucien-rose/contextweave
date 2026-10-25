import { safeJsonArray } from "./lib/json.js";

export function hydrateMemory(row) {
  return { ...row, tags: safeJsonArray(row.tags_json), triggers: safeJsonArray(row.triggers_json),
    ambient_triggers: safeJsonArray(row.ambient_triggers_json), standing_opt_in: Boolean(row.standing_opt_in) };
}
