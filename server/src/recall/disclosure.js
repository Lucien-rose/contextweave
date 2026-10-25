import { INTIMATE_QUERY_MARKERS } from "./constants.js";
import { normalize } from "./runtime.js";

const PRIVATE_TEXT_MARKERS = [
  "做爱", "性交", "性爱", "性器", "阴茎", "阴蒂", "小穴", "阴道", "后穴", "肛", "乳头",
  "自慰", "高潮", "射精", "口交", "睡奸", "强奸", "奶嘴", "调教", "肏", "操穴",
];

export function semanticSituationMayUnlockBody(query) {
  const text = normalize(query);
  return Boolean(text) && (INTIMATE_QUERY_MARKERS.some((marker) => text.includes(normalize(marker)))
    || /(?:想你|爱你|恋人|伴侣|我们之间|抱抱|亲亲|吻我|撒娇|亲密)/.test(text));
}

export function safeDiscoveryText(value) {
  const text = normalize(value);
  return Boolean(text) && !PRIVATE_TEXT_MARKERS.some((marker) => text.includes(marker));
}

export function safeDiscoveryTitle(value) {
  return normalize(value).length >= 2 && safeDiscoveryText(value);
}
