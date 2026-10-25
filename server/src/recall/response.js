import { excerpt } from "./presentation.js";

export function recallResponse(recalled, { query, separateBackground = true } = {}) {
  const background = recalled.background_memories || [];
  const route = recalled.trace.route;
  return {
    query: query.length > 256 ? excerpt(query, 256) : query, route, verification: recalled.verification,
    memories: separateBackground ? recalled.memories : [...recalled.memories, ...background],
    background_memories: separateBackground ? background : [],
    background_mode: separateBackground ? "separate" : "combined",
    ...(recalled.delivery ? { delivery: recalled.delivery } : {}),
    guidance: recalled.verification?.guidance || (route === "NO_RECALL"
      ? "No recall is valid. For an indirect question, retry once with a generic context_envelope only if the visible conversation supports it; never guess stored IDs."
      : "Use silently. T0 is direct; T1 supports; T2 associates. Ambient/policy cues do not prove unrelated facts. Preserve evidence scope; use moss_expand when exact detail is needed."),
  };
}
