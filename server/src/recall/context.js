import { MAX_CONTEXT_DESCRIPTOR_ITEMS, MAX_CONTEXT_HYPOTHESES } from "./constants.js";
import { contextualRecallEnabled } from "./runtime.js";

export function normalizeContextEnvelope(value) {
  if (!contextualRecallEnabled() || !value || typeof value !== "object" || Array.isArray(value)) {
    return { present: false, hypotheses: [], entities: [], topics: [], stateCues: [], hypothesisCount: 0, descriptorCount: 0 };
  }
  const hypotheses = cleanContextStrings(value.recall_hypotheses, MAX_CONTEXT_HYPOTHESES, 500);
  const hypothesisCount = hypotheses.length;
  const entities = cleanContextStrings(value.entities, MAX_CONTEXT_DESCRIPTOR_ITEMS, 120);
  const topics = cleanContextStrings(value.topics, MAX_CONTEXT_DESCRIPTOR_ITEMS, 120);
  const stateCues = cleanContextStrings(value.state_cues, MAX_CONTEXT_DESCRIPTOR_ITEMS, 120);
  const descriptors = [
    cleanContextScalar(value.speech_act, 80),
    cleanContextScalar(value.action_phase, 80),
    ...entities,
    ...topics,
    ...stateCues,
  ].filter(Boolean);
  if (descriptors.length) hypotheses.push(descriptors.join(" "));
  return {
    present: true,
    hypotheses: [...new Set(hypotheses)].slice(0, MAX_CONTEXT_HYPOTHESES + 1),
    entities,
    topics,
    stateCues,
    hypothesisCount,
    descriptorCount: descriptors.length,
  };
}

function cleanContextStrings(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanContextScalar(item, maxLength)).filter(Boolean))]
    .slice(0, maxItems);
}

function cleanContextScalar(value, maxLength) {
  const result = String(value || "").replace(/\s+/g, " ").trim();
  return result ? result.slice(0, maxLength) : "";
}

