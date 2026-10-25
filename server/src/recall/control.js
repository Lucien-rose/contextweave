export const RECALL_CONTROL_MODES = Object.freeze([
  "normal",
  "suppress_situation",
  "no_recall",
]);
export const RECALL_CONTROL_SOURCES = Object.freeze(["conversation", "client"]);

const MODES = new Set(RECALL_CONTROL_MODES);
const SOURCES = new Set(RECALL_CONTROL_SOURCES);

export function normalizeRecallControl(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return control("normal", "default", false);
  }
  const mode = MODES.has(value.mode) ? value.mode : "normal";
  const source = SOURCES.has(value.source) ? value.source : "conversation";
  return control(mode, source, true);
}

function control(mode, source, provided) {
  return Object.freeze({
    mode,
    source,
    scope: "turn",
    provided,
    suppressSituation: mode === "suppress_situation" || mode === "no_recall",
    suppressAll: mode === "no_recall",
  });
}
