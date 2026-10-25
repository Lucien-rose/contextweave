import { GENERIC_IDENTITY_CUES, INTIMATE_QUERY_MARKERS, TECHNICAL_MARKERS } from "./constants.js";
import { normalize, privateTechIsolationEnabled } from "./runtime.js";
import { containsText } from "../lib/text-match.js";

export function shouldSuppressPrivateTechnicalWeakOnly(memory, {
  query, context, intimacyMode, admission, rawEvidence, technicalIntent,
}) {
  return privateTechIsolationEnabled()
    && context === "private"
    && ["proactive", "model"].includes(intimacyMode)
    && admission.reason === "private-standing-route"
    && memory.sensitivity === "intimate"
    && technicalIntent
    && !rawEvidence.explicit
    && !hasRelationshipIntent(query);
}

export function isTechnicalTask(rawQuery) {
  const query = normalize(rawQuery);
  const hits = TECHNICAL_MARKERS.filter((pattern) => pattern.test(query)).length;
  return hits >= 2;
}

export function hasRelationshipIntent(rawQuery) {
  const query = normalize(rawQuery);
  return /(?:亲密|情欲|做爱|调教|高潮|奶嘴|自慰|初夜|撒娇|想你|我们之间|抱抱|亲亲|吻我|黏着|黏你|爱你|恋人|伴侣|身体约定|我们的(?:约定|协议|契约|誓言)|还记得.{0,12}(?:约定|协议|契约|誓言)|誓言|盟誓)/.test(query);
}


export function isAllowed(memory, policy) {
  return admissionDecision(memory, policy).allowed;
}

export function admissionDecision(memory, {
  query, context, intimacyMode, trustedEvidence = null, allowedStatuses = ["active"], modelInspection = false,
}) {
  if (!allowedStatuses.includes(memory.status)) return { allowed: false, reason: "state-scope-gate" };
  if (memory.sensitivity !== "intimate") return { allowed: true, reason: "non-intimate" };
  if (memory.egress_policy !== "local_only") return { allowed: false, reason: "egress-policy-gate" };
  if (!["private", "intimate"].includes(context)) return { allowed: false, reason: "audience-context-gate" };
  if (intimacyMode === "off") return { allowed: false, reason: "intimacy-mode-gate" };
  if (context === "intimate") return { allowed: true, reason: "intimate-context" };
  if (intimacyMode === "on") return { allowed: true, reason: "private-user-on" };
  if (intimacyMode === "model") intimacyMode = "proactive";
  if (intimacyMode === "scene") return { allowed: true, reason: "private-scene-route" };
  if (memory.scope !== "private_relationship") return { allowed: false, reason: "policy-scope-gate" };
  const activationPolicy = memory.activation_policy || "explicit_trigger";
  if (activationPolicy === "scene_only") return { allowed: false, reason: "scene-only-policy" };
  if (modelInspection && intimacyMode === "proactive") return { allowed: true, reason: "model-context-pending" };
  if (intimacyMode === "proactive" && trustedEvidence === "temporal") {
    return { allowed: true, reason: "private-temporal-route" };
  }
  if (intimacyMode === "proactive" && activationPolicy === "relationship_contextual" && memory.standing_opt_in) {
    return { allowed: true, reason: "private-standing-route" };
  }
  if (["responsive", "proactive"].includes(intimacyMode) && responsivePrivateActivation(memory, query)) {
    return { allowed: true, reason: "private-explicit-trigger-route" };
  }
  if (["responsive", "proactive"].includes(intimacyMode)
    && trustedEvidence === "situation"
    && activationPolicy === "explicit_trigger") {
    return { allowed: true, reason: "private-situation-trigger-route" };
  }
  return { allowed: false, reason: "intimacy-mode-gate" };
}


export function responsivePrivateActivation(memory, rawQuery) {
  const query = normalize(rawQuery);
  if (!query) return false;
  if (INTIMATE_QUERY_MARKERS.some((marker) => query.includes(normalize(marker)))) return true;
  return directIdentityCueMatch(memory, query);
}

export function directIdentityCueMatch(memory, query) {
  const cues = [memory.title, ...memory.triggers, ...memory.ambient_triggers]
    .map(normalize)
    .filter((cue) => cue.length >= 2 && !GENERIC_IDENTITY_CUES.has(cue));
  return cues.some((cue) => containsText(query, cue) || (query.length >= 3 && containsText(cue, query)));
}
