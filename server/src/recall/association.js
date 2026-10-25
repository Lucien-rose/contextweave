import { GENERIC_IDENTITY_CUES, GENERIC_QUERY_TERMS } from "./constants.js";
import { lexicalWords } from "./evidence.js";
import { normalize } from "./runtime.js";

// Dataset markers, record types and placeholder-title words are not topic links.
const STRUCTURAL_CUES = new Set([
  "demo", "synthetic", "sample", "visitor", "memory", "preference", "plan", "decision",
]);

export function associationBridge(seed, candidate, { queryVector = null } = {}) {
  if (!seed || !candidate || seed.id === candidate.id) return { qualified: false, cue: null };
  const seedCues = memoryCues(seed);
  const candidateText = normalize([
    candidate.title,
    ...(candidate.tags || []),
    ...(candidate.triggers || []),
    ...(candidate.ambient_triggers || []),
    String(candidate.content || "").slice(0, 1800),
  ].join(" "));
  const shared = seedCues.filter((cue) => candidateText.includes(cue));
  const cue = shared.sort((a, b) => b.length - a.length || compareText(a, b))[0] || null;
  const qualified = Boolean(cue && (cue.length >= 3 || shared.length >= 2));
  if (qualified) return { qualified: true, cue };
  // A qualified seed-neighbour plus query support need not share literal words.
  if (queryVector?.absolute_qualified) {
    return { qualified: true, cue: "query-supported semantic association" };
  }
  return { qualified: false, cue: null };
}

function memoryCues(memory) {
  const raw = [
    ...(memory.tags || []),
    ...(memory.triggers || []),
    ...(memory.ambient_triggers || []),
    ...lexicalWords(memory.title),
  ];
  return [...new Set(raw.map(normalize).filter(isSelectiveCue))];
}

function isSelectiveCue(cue) {
  return cue.length >= 2
    && !cue.startsWith("signal:")
    && !STRUCTURAL_CUES.has(cue)
    && !GENERIC_IDENTITY_CUES.has(cue)
    && !GENERIC_QUERY_TERMS.has(cue);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
