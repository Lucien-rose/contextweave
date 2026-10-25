import { defaults, timezone } from "./defaults.js";
import { listMemories, listObservances, markRecalled } from "./database.js";
import { GENERAL_DEEP_CATEGORIES } from "./recall/constants.js";
import { normalizeContextEnvelope } from "./recall/context.js";
import { isAllowed } from "./recall/admission.js";
import { scoreMemoryDetailed, scoreMemoryForContext } from "./recall/evidence.js";
import {
  compareScored, compareVersions, freshnessBoost, isRecentlyRead, recentSets, selectRecallRepresentatives, uniqueById,
} from "./recall/ranking.js";
import {
  anchor, deepCategory, deepToSummary, evergreenPriorityBoost, fullMemory, matchReason, mentionabilityBoost, summarize,
  recallRepresentation,
} from "./recall/presentation.js";
import { clamp } from "./recall/runtime.js";
import { readFamilyGroups } from "./family/groups.js";
import { buildCompactHomecoming } from "./homecoming.js";
import { fitSections, returnBudget, updateCharacterCount } from "./recall/response-budget.js";

export { recallMemories, recallMemoriesWithTrace } from "./recall/sqlite.js";

export function buildHomecomingBundle(db, {
  schemaVersion = 3,
  totalBudgetChars,
  subjectId = "user",
  query = "",
  context = "general",
  intimacyMode = "off",
  recentlyReadIds = [],
  recentlyReadHashes = [],
  recentlyReadFamilies = [],
  contentBudget = defaults.mainChars,
  contextEnvelope = null,
  at = new Date(),
  recordRecall = true,
} = {}) {
  if (schemaVersion === 3) {
    const observances = memoriesForDate(db, { context, intimacyMode, limit: 2,
      date: new Date(at).toLocaleDateString("sv-SE", { timeZone: timezone }),
      recentlyReadIds, recentlyReadHashes, recentlyReadFamilies, recordRecall: false });
    const bundle = buildCompactHomecoming(db, { query, context, intimacyMode, subjectId, at,
      recentlyReadIds, recentlyReadHashes, recentlyReadFamilies, totalBudgetChars }, observances);
    if (recordRecall) markRecalled(db, [...bundle.observances, ...bundle.continuity_seed].map((item) => item.id));
    return bundle;
  }
  if (schemaVersion !== 2) throw new TypeError("Unsupported homecoming schema version");
  const recent = recentSets(recentlyReadIds, recentlyReadHashes, recentlyReadFamilies);
  const groups = readFamilyGroups(db);
  const all = listMemories(db).map((memory) => groups.has(memory.id)
    ? { ...memory, family_branch_key: groups.get(memory.id) } : memory);
  const envelope = normalizeContextEnvelope(contextEnvelope);
  const eligible = all.filter((memory) => isAllowed(memory, { query, context, intimacyMode }));
  const general = eligible.filter((memory) => memory.sensitivity !== "intimate");
  const intimate = eligible.filter((memory) => memory.sensitivity === "intimate");

  const generalRanked = selectRecallRepresentatives(general
    .filter((memory) => !isRecentlyRead(memory, recent))
    .map((memory) => ({
      memory,
      score: memory.importance + scoreMemoryForContext(memory, query, envelope) + freshnessBoost(memory)
        + mentionabilityBoost(memory) + evergreenPriorityBoost(memory),
    }))
    .sort(compareScored)).selected;
  const intimateRanked = intimate
    .filter((memory) => memory.kind !== "intimate-agreement")
    .filter((memory) => !isRecentlyRead(memory, recent))
    .map((memory) => ({
      memory,
      score: memory.importance + scoreMemoryForContext(memory, query, envelope) + freshnessBoost(memory)
        + mentionabilityBoost(memory) + evergreenPriorityBoost(memory),
    }))
    .sort(compareScored);

  const selectedGeneral = chooseGeneralDeepReads(generalRanked, 4);
  const selectedIntimate = intimateRanked.slice(0, 2);
  const budgeted = applyContentBudget(selectedGeneral, selectedIntimate, clamp(contentBudget, 1000, 20000));
  const selectedIds = new Set([...budgeted.general, ...budgeted.intimate].map(({ memory }) => memory.id));

  const workingSummaries = generalRanked
    .filter(({ memory }) => !selectedIds.has(memory.id))
    .filter(({ memory }) => memory.layer === "context" || memory.kind === "handoff" || scoreMemoryForContext(memory, query, envelope) > 0)
    .slice(0, 6)
    .map(({ memory, score }) => summarize(memory, score, {
      matchReason: matchReason(memory, query),
      recommendedMode: "summary",
    }));

  const agreementManifest = currentAgreementManifest(intimate).map((memory) => fullMemory(memory, {
    score: memory.importance,
    matchReason: "active-standing-agreement",
    recommendedMode: "manifest",
  }));

  const generalAnchors = selectRecallRepresentatives(generalRanked).selected
    .filter(({ memory }) => !selectedIds.has(memory.id))
    .slice(0, 16)
    .map(({ memory, score }) => anchor(memory, score));
  const intimateAnchors = intimate
    .filter((memory) => !selectedIds.has(memory.id))
    .sort((a, b) => b.importance - a.importance || b.version - a.version)
    .slice(0, 18)
    .map((memory) => anchor(memory, memory.importance));

  const deepGeneral = budgeted.general.map(({ memory, score }) => fullMemory(memory, {
    score,
    matchReason: `homecoming-${deepCategory(memory)}`,
    recommendedMode: "deep",
  }));
  const deepIntimate = budgeted.intimate.map(({ memory, score }) => fullMemory(memory, {
    score,
    matchReason: "intimate-rotation",
    recommendedMode: "deep",
  }));
  const observances = memoriesForDate(db, { context, intimacyMode, days: 7, limit: 2,
    recentlyReadIds, recentlyReadHashes, recentlyReadFamilies, recordRecall: false });

  const compatibilityMemories = uniqueById([
    ...deepGeneral.map(deepToSummary),
    ...deepIntimate.map(deepToSummary),
    ...workingSummaries,
    ...agreementManifest.map(deepToSummary),
  ]).slice(0, 12);

  const bundle = {
    schema_version: 2,
    purpose: "layered-homecoming",
    context,
    intimacy_mode: intimacyMode,
    deep_reads: { general: deepGeneral, intimate: deepIntimate },
    working_summaries: workingSummaries,
    anchors: { general: generalAnchors, intimate: intimateAnchors },
    agreement_manifest: agreementManifest,
    observances,
    memories: compatibilityMemories,
    budgets: {
      full_content_characters: [...deepGeneral, ...deepIntimate].reduce((sum, item) => sum + item.content.length, 0),
      full_content_limit: clamp(contentBudget, 1000, 20000),
    },
  };
  const total = returnBudget(totalBudgetChars);
  bundle.budgets.total_limit = total;
  bundle.memories = [];
  fitSections(bundle, [["deep_reads", "general"], ["deep_reads", "intimate"], ["agreement_manifest"],
    ["observances"], ["working_summaries"], ["anchors", "general"], ["anchors", "intimate"]], total - 512);
  // Only the explicit v2 adapter retains the old alias, within the same ceiling.
  bundle.memories = compatibilityMemories;
  fitSections(bundle, [["memories"]], total - 512);
  bundle.budgets.full_content_characters = [...bundle.deep_reads.general, ...bundle.deep_reads.intimate]
    .reduce((sum, item) => sum + item.content.length, 0);
  updateCharacterCount(bundle);
  if (recordRecall) markRecalled(db, [...new Set([...bundle.deep_reads.general, ...bundle.deep_reads.intimate,
    ...bundle.working_summaries, ...bundle.agreement_manifest, ...bundle.observances, ...bundle.memories].map((item) => item.id))]);
  return bundle;
}

export function bootstrapMemories(db, {
  query = "", context = "general", intimacyMode = "off", limit = 8,
  contextEnvelope = null, at = new Date(),
} = {}) {
  const bundle = buildHomecomingBundle(db, {
    query, context, intimacyMode, contextEnvelope, at, schemaVersion: 2,
  });
  return uniqueById([...bundle.memories, ...bundle.deep_reads.general.map(deepToSummary),
    ...bundle.deep_reads.intimate.map(deepToSummary), ...bundle.working_summaries]).slice(0, clamp(limit, 3, 12));
}

export function memoriesForDate(db, {
  date = todayInConfiguredZone(), days = 7, context = "general", intimacyMode = "off", limit = 12,
  recentlyReadIds = [], recentlyReadHashes = [], recentlyReadFamilies = [], recordRecall = true,
} = {}) {
  const recent = recentSets(recentlyReadIds, recentlyReadHashes, recentlyReadFamilies);
  const start = new Date(`${date}T00:00:00Z`);
  const windows = new Set();
  const exactDates = new Set();
  const calendarCues = new Set();
  for (let offset = 0; offset <= clamp(days, 0, 31); offset += 1) {
    const cursor = new Date(start.getTime() + offset * 86_400_000);
    windows.add(`${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`);
    const exactDate = cursor.toISOString().slice(0, 10);
    exactDates.add(exactDate);
    for (const cue of calendarCuesForDate(exactDate)) calendarCues.add(cue);
  }
  const active = listMemories(db);
  const direct = active.filter((memory) => memory.event_date && windows.has(memory.event_date.slice(5)));
  const observed = listObservances(db).filter((memory) =>
    (memory.recurring && memory.month_day && windows.has(memory.month_day)) ||
    (!memory.recurring && memory.exact_date && exactDates.has(memory.exact_date)));
  const calendarMatched = active.filter((memory) => [...calendarCues].some((cue) => {
    const evidence = scoreMemoryDetailed(memory, cue);
    return evidence.direct && evidence.score >= 7;
  }));
  const directIds = new Set([...direct, ...observed].map((memory) => memory.id));
  const calendarIds = new Set(calendarMatched.map((memory) => memory.id));
  const result = [...new Map([...direct, ...observed, ...calendarMatched].map((memory) => [memory.id, memory])).values()]
    .filter((memory) => !isRecentlyRead(memory, recent))
    .filter((memory) => isAllowed(memory, {
      query: "纪念日", context, intimacyMode, trustedEvidence: "temporal",
    }))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, clamp(limit, 1, 12))
    .map((memory) => summarize(memory, memory.importance, {
      matchReason: directIds.has(memory.id) ? "observance" : (calendarIds.has(memory.id) ? "calendar-context" : "observance"),
      recommendedMode: "summary",
    }));
  if (recordRecall) markRecalled(db, result.map((item) => item.id));
  return result;
}

function chooseGeneralDeepReads(ranked, limit) {
  const selected = [];
  const used = new Set();
  for (const category of GENERAL_DEEP_CATEGORIES) {
    const candidate = ranked.find(({ memory }) => !used.has(memory.id) && deepCategory(memory) === category);
    if (candidate) {
      selected.push(candidate);
      used.add(candidate.memory.id);
    }
  }
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (!used.has(candidate.memory.id)) {
      selected.push(candidate);
      used.add(candidate.memory.id);
    }
  }
  return selected.slice(0, limit);
}

function applyContentBudget(general, intimate, budget) {
  const output = { general: [], intimate: [] };
  let remaining = budget;
  for (const [key, entries] of [["general", general], ["intimate", intimate]]) {
    for (const entry of entries) {
      const length = recallRepresentation(entry.memory).content.length;
      if (length <= remaining) {
        output[key].push(entry);
        remaining -= length;
      }
    }
  }
  return output;
}

function currentAgreementManifest(memories) {
  const agreements = memories.filter((memory) =>
    memory.status === "active" && (memory.kind === "intimate-agreement" || memory.load_policy === "manifest-always"));
  const byFamily = new Map();
  for (const memory of agreements) {
    const key = memory.family_branch_key || memory.family_key || memory.id;
    const current = byFamily.get(key);
    if (!current || compareVersions(memory, current) < 0) byFamily.set(key, memory);
  }
  return [...byFamily.values()].sort((a, b) => b.importance - a.importance || compareVersions(a, b));
}


function todayInConfiguredZone() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function calendarCuesForDate(dateString) {
  const date = new Date(`${dateString}T12:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return [];
  const formatted = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
    timeZone: timezone, year: "numeric", month: "long", day: "numeric",
  }).format(date);
  const match = formatted.match(/年(.+?)月(\d+)$/);
  if (!match) return [];
  const lunarMonth = match[1];
  const lunarDay = Number(match[2]);
  const dayName = chineseLunarDay(lunarDay);
  const cues = [`农历${lunarMonth}月${dayName}`, `${lunarMonth}月${dayName}`];
  if (lunarMonth === "七" && lunarDay === 7) cues.unshift("七夕");
  return cues;
}

function chineseLunarDay(day) {
  const digits = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  if (day <= 10) return `初${digits[day - 1]}`;
  if (day < 20) return `十${digits[day - 11] || ""}`;
  if (day === 20) return "二十";
  if (day < 30) return `廿${digits[day - 21] || ""}`;
  return "三十";
}
