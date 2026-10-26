import { defaults } from "../defaults.js";
import { clampInteger } from "../lib/number.js";
import { compactRecallCue } from "./packing.js";
import { excerpt } from "./presentation.js";

export function isBackgroundEntry(entry) {
  return entry.semanticBackground || !entry.rawDirectEvidence && (["ambient", "policy"].includes(entry.recallRole)
    || ["style", "ambient"].includes(entry.memory.kind));
}

// Admission, current-state authority and family selection have already run.
// Background is a separate lane, never a reserve slot in the main recall pack.
export function selectBackground(items, { maxItems = defaults.backgroundItems, charBudget = defaults.backgroundChars } = {}) {
  const limit = clampInteger(maxItems, 0, 3, 2);
  const budget = clampInteger(charBudget, 0, 4000, defaults.backgroundChars);
  const selected = [];
  const decisions = new Map();
  let selectedChars = 0;
  for (const item of items) {
    const { read_via, recall_path, source_channels, recall_reason, ...cue } = compactRecallCue(item.presentation);
    const presentation = { ...cue,
      recall_role: "ambient", evidence_type: "ambient_context", detail_level: "cue",
      excerpt: excerpt(item.presentation.excerpt || "", 180) };
    const chars = JSON.stringify(presentation).length;
    const accepted = selected.length < limit && selectedChars + chars <= budget;
    decisions.set(item.entry.memory.id, {
      packing_decision: accepted ? "background-selected" : "background-budget",
      presentation_chars: accepted ? chars : 0, presentation_mode: "background",
    });
    if (!accepted) continue;
    selected.push({ entry: item.entry, presentation });
    selectedChars += chars;
  }
  return { selected, selectedChars, charBudget: budget, maxItems: limit, decisions };
}

