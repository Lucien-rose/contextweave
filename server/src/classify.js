import { recallProfile } from "./recall/profile.js";

const LOCAL_PROFILE = recallProfile();
export const ANCHORS = LOCAL_PROFILE.classification_anchors;
const CORE_TERMS = [
  "约定", "生日", "身份", "偏好", "目标", "计划", "里程碑",
  ...LOCAL_PROFILE.classification_core_terms,
];
const PRIORITY_ANCHORS = new Set(LOCAL_PROFILE.classification_priority_anchors);

const INTIMATE_TERMS = [
  "情欲", "自慰", "高潮", "阴蒂", "小穴", "后穴", "乳", "性器", "射精", "做爱",
  "性行为", "性生活", "性交", "性隐私",
];

const HEALTH_TERMS = ["手术", "体检", "医生", "疼", "受伤", "过敏", "牙齿", "麻醉"];

export function classifyMemory({ title = "", content = "", section = "" }) {
  const haystack = `${title}\n${content}`;
  const triggers = ANCHORS.filter((term) => haystack.includes(term));
  const tags = [...new Set(triggers.map(normalizeTag))];
  const coreHits = CORE_TERMS.filter((term) => haystack.includes(term)).length;
  const intimate = INTIMATE_TERMS.some((term) => haystack.includes(term));
  const health = HEALTH_TERMS.some((term) => haystack.includes(term));

  let sensitivity = "private";
  let mentionability = "contextual";
  if (intimate) sensitivity = "intimate";
  if (health) sensitivity = "sensitive";

  let importance = 45;
  if (section === "model_set_context") importance += 10;
  importance += Math.min(coreHits * 8, 40);
  if (triggers.some((trigger) => PRIORITY_ANCHORS.has(trigger))) importance = 100;
  importance = Math.max(0, Math.min(100, importance));

  let layer = "archive";
  if (importance >= 85) layer = "core";
  else if (importance >= 60) layer = "context";

  if (layer === "core" && !intimate) mentionability = "natural";
  if (intimate) mentionability = "contextual";

  return {
    tags,
    triggers,
    ambient_triggers: intimate ? triggers : [],
    sensitivity,
    mentionability,
    importance,
    layer,
  };
}

export function extractEventDate(text) {
  const match = String(text).match(/(?:\[|时间[:：]?\s*)?(20\d{2})[-年](\d{1,2})[-月](\d{1,2})(?:日)?/);
  if (!match) return null;
  return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
}

export function deriveTitle(text, fallback) {
  const value = String(text).trim();
  if (/农历生日.*公历生日/.test(value)) return LOCAL_PROFILE.birthday_title;
  const bracketed = value.match(/【([^】]{2,60})】/);
  if (bracketed) return bracketed[1].trim();
  const named = value.match(/《([^》]{2,60})》/);
  if (named) return named[1].trim();
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return fallback;
  const cleaned = lines[0]
    .replace(/^\[?20\d{2}[-年]\d{1,2}[-月]\d{1,2}(?:日)?\]?[,，.。]?\s*/, "")
    .replace(/^将以下内容(?:写入|加入)记忆库[,，：:]?\s*/, "")
    .replace(/^将/, "")
    .slice(0, 60);
  return cleaned || fallback;
}

export function deriveObservances(title, content, eventDate) {
  const text = `${title}\n${content}`;
  const output = [];
  if (eventDate && /(誓约|誓言|初夜|纪念|里程碑)/.test(text)) {
    output.push({ label: title, exact_date: eventDate, month_day: eventDate.slice(5), recurring: true });
  }
  if (/(生日|诞生日)/.test(text)) {
    for (const match of text.matchAll(/(?:(20\d{2})年(?:为|是)?)?(\d{1,2})月(\d{1,2})日/g)) {
      const monthDay = `${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
      output.push({
        label: title,
        exact_date: match[1] ? `${match[1]}-${monthDay}` : null,
        month_day: monthDay,
        recurring: !match[1],
      });
    }
  }
  return output.filter((item, index, array) => index === array.findIndex((other) =>
    other.label === item.label && other.exact_date === item.exact_date && other.month_day === item.month_day));
}

function normalizeTag(value) {
  return value.toLowerCase().replace(/\s+/g, "-");
}

