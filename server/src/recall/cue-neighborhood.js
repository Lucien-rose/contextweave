import { createHash } from "node:crypto";
import { containsText } from "../lib/text-match.js";
import { GENERIC_QUERY_TERMS, GENERIC_IDENTITY_CUES } from "./constants.js";
import { safeDiscoveryText } from "./disclosure.js";
import { semanticCueAliases } from "./lexical-signals.js";
import { normalize } from "./runtime.js";
import { publicRecallProjection } from "../memory-summary.js";

// Read-only, metadata-only cue neighbours; never accepted relation assertions.
export function observeCueNeighborhood(runtime, candidates, query, { mode = "observe" } = {}) {
  const result = { schema_version: "cue-neighborhood-v1", mode, activated: false,
    answer_authority_granted: false, coverage: "bounded-cue-metadata", cues: [], edges: [] };
  if (mode === "off" || runtime.control.suppressAll) return result;
  const trace = new Map(candidates.map((item) => [item.id, item]));
  const records = runtime.loaded.filter((memory) => {
    const item = trace.get(memory.id);
    return item?.policy_allowed && !["recently-read", "historical-state-unrequested", "nominal-historical-weak-match"].includes(item.reason);
  }).map((memory) => publicRecallProjection(memory, runtime.context));
  const seeds = records.filter((memory) => trace.get(memory.id)?.candidate_generated);
  const seen = new Set();
  let inspected = 0;
  for (const seed of seeds) {
    for (const cue of [...seed.triggers, ...seed.ambient_triggers].map(normalize)) {
      if (result.cues.length >= 8 || inspected >= 512) return result;
      if (seen.has(cue) || !eligibleCue(cue) || !containsText(query, cue)) continue;
      seen.add(cue);
      const aliases = semanticCueAliases(cue).filter(eligibleCue).slice(0, 12);
      if (!aliases.length) continue;
      const id = "cue:" + createHash("sha256").update(cue).digest("hex").slice(0, 24);
      result.cues.push({ id, type: "metadata-cue", source: "explicit-query-match", seed_ids: [seed.id] });
      for (const memory of records) {
        if (++inspected > 512 || result.edges.length >= 24) return result;
        if (memory.id === seed.id) continue;
        const metadata = [memory.title, ...memory.triggers, ...memory.ambient_triggers].map(normalize).join(" ");
        if (!aliases.some((alias) => containsText(metadata, alias))) continue;
        result.edges.push({ cue_id: id, candidate_id: memory.id, relation: "semantic-cue-neighbor",
          candidate_only: true, would_add: !trace.get(memory.id)?.final });
      }
    }
  }
  return result;
}

function eligibleCue(cue) {
  return cue.length >= 3 && cue.length <= 120 && !cue.startsWith("signal:")
    && !GENERIC_QUERY_TERMS.has(cue) && !GENERIC_IDENTITY_CUES.has(cue) && safeDiscoveryText(cue);
}

