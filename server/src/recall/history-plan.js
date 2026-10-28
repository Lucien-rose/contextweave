import { normalize } from "./runtime.js";

const HISTORICAL_REFERENCE = /(?:过去|以前|曾经|当时|原本|原先|早先|从前|此前|之前|最初|最早(?:版本|一版)?|初版|旧(?:的|版|方案|计划|偏好|记录|状态)|历史|\bformerly\b|\bprevious(?:ly)?\b|\bprior\b|\bold\s+(?:version|plan|preference|state|record|setting|agreement)\b)/i;
const CURRENT_REFERENCE = /(?:现在|如今|当前|目前|现行|最新版|后来|之后|today|now|current(?:ly)?|latest)/i;
const COMPARISON_INTENT = /(?:变化|变迁|演变|区别|差别|相比|对比|比较|后来呢|怎么变|如何变|change|compare|difference|evol)/i;
const INFORMATION_REQUEST = /(?:什么|为何|为什么|怎么|怎样|如何|哪(?:个|些|里|一)?|何时|什么时候|是否|有没有|吗|谁|几|多少|\?|？|查(?:一下|看|找|询)?|找(?:一下|出|到)?|读(?:一下|取)?|回忆|追溯|核对|确认|告诉我|讲讲|说说|展开|列出|show|tell|find|lookup|recall|what|why|how|when|which|who)/i;
const SUPERSEDED_STATE_INTENT = /(?:旧(?:版|版本|方案|计划|偏好|状态|记录|设置|配置|条款|约定)|最早(?:版本|一版)|最初版本|初版|上一版|前一版|历史版本|(?:原本|原先|早先).{0,16}(?:方案|计划|偏好|状态|版本|写|准备|允许|规定|设定|设置|配置)|(?:过去|以前).{0,16}(?:喜欢|偏好|习惯|使用|采用|方案|计划|状态|设置|配置)|(?:修改|修订|更新|替换|纠正|更改)前|(?:old|previous|prior|earliest|original)\s+(?:version|plan|preference|state|record|setting|agreement))/i;

export const HISTORICAL_ROUTE_SCHEMA = "historical-route-v1";

export function historicalSuppressionReason(plan, memory, historicalFamilyKeys, {
  contextualMatch = true, canonicalMatchReason = "",
} = {}) {
  if (!plan.superseded_state_reference || plan.historical_intent || memory.status !== "active") return null;
  if (historicalFamilyKeys.has(memory.family_key)) return "historical-state-unrequested";
  if (!contextualMatch && canonicalMatchReason === "semantic-overlap") {
    return "nominal-historical-weak-match";
  }
  return null;
}

export function resolveHistoricalRoute(rawQuery) {
  const query = normalize(rawQuery);
  const supersededStateIntent = SUPERSEDED_STATE_INTENT.test(query);
  const historicalReference = HISTORICAL_REFERENCE.test(query) || supersededStateIntent;
  const currentReference = CURRENT_REFERENCE.test(query);
  const comparisonIntent = historicalReference
    && (currentReference || COMPARISON_INTENT.test(query));
  const historicalIntent = historicalReference
    && (comparisonIntent
      || (INFORMATION_REQUEST.test(query) && supersededStateIntent));

  if (comparisonIntent) {
    return Object.freeze({
      schema_version: HISTORICAL_ROUTE_SCHEMA,
      state_scope: "current-and-history",
      historical_reference: true,
      historical_intent: true,
      compare_current: true,
      candidate_statuses: Object.freeze(["active", "superseded"]),
      reason: "explicit-state-comparison",
    });
  }
  if (historicalIntent) {
    return Object.freeze({
      schema_version: HISTORICAL_ROUTE_SCHEMA,
      state_scope: "historical",
      historical_reference: true,
      historical_intent: true,
      compare_current: false,
      candidate_statuses: Object.freeze(["superseded"]),
      reason: "explicit-historical-information-request",
    });
  }
  return Object.freeze({
    schema_version: HISTORICAL_ROUTE_SCHEMA,
    state_scope: "current",
    historical_reference: historicalReference,
    superseded_state_reference: supersededStateIntent,
    historical_intent: false,
    compare_current: false,
    candidate_statuses: Object.freeze(["active"]),
    reason: historicalReference
      ? supersededStateIntent ? "historical-reference-without-information-request" : "event-recollection"
      : "default-current-state",
  });
}
