export function relativeTailFilterEnabled() {
  return process.env.MOSS_RECALL_RELATIVE_TAIL !== "0";
}

export function privateTechIsolationEnabled() {
  return process.env.MOSS_PRIVATE_TECH_ISOLATION !== "0";
}

export function contextualRecallEnabled() {
  return process.env.MOSS_CONTEXTUAL_RECALL !== "0";
}

export function contextualEvidenceHardeningEnabled() {
  return process.env.MOSS_CONTEXTUAL_EVIDENCE_HARDENING !== "0";
}

export function lexicalEvidenceV2Enabled() {
  return process.env.MOSS_RECALL_LEXICAL_EVIDENCE_V2 !== "0";
}

export function ftsShadowEnabled(mode = "default") {
  if (mode === "observe") return true;
  if (mode === "off") return false;
  return process.env.MOSS_RECALL_FTS_SHADOW !== "0";
}

export function resolveSituationMode(mode = "default") {
  if (["off", "observe", "on"].includes(mode)) return mode;
  if (process.env.MOSS_RECALL_SITUATION_SHADOW === "0") return "off";
  const configured = String(process.env.MOSS_RECALL_SITUATION_MODE || "on").toLowerCase();
  return ["off", "observe", "on"].includes(configured) ? configured : "on";
}

export function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || min));
}

export function round(value) {
  return Math.round(Number(value) * 100) / 100;
}
