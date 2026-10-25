// Context Lens admission blockers use current-request evidence only.
// They protect subject/task/meta boundaries; recall-control is a separate,
// explicit control plane handled before Context Lens is invoked.
const TECHNICAL_OR_META = /(?:测试|触发器|检索|召回|索引|门控|shadow|debug|代码|部署|schema|mcp|接口)/i;
const AMBIGUOUS_TECHNICAL_NOUN = /(?:日志|版本)/;
const EXPLICIT_SHARED_RECOLLECTION = /(?:还记得|记得.{0,12}(?:那|我们)|想起|回忆|说过的话)/;
const RELATIONAL_CONTENT = /(?:约定|协议|契约|誓言|我们之间|彼此|害怕|想你|爱你|抱抱|亲吻|撒娇|恋人|伴侣|爱人|我们说过)/;
const SHARED_HISTORY = /(?:那次|那天|当时|以前|过去|之前|曾经|后来|第一次|上次)/;
const SHARED_PARTICIPANT = /(?:我们|一起|先生|彼此)/;
const OPERATIONAL_REQUEST = /(?:^|[，。！？,.!?\s])(?:请|帮我|麻烦|现在|接下来|先|再|去|开始|继续|需要|要|能不能|可以|替我)?\s*(?:检查|核验|排查|调试|修复|安装|运行|配置|升级|发布|分析|查看|读取|查一下)/;
const NON_RELATIONAL_TASK = /(?:论文|作业|工作|上班|开会|课程|考试|报告|写稿|写代码|提交|deadline|ddl)/i;
const RELATION_CUE = /(?:先生|恋人|伴侣|爱人|我们之间|彼此|约定|协议|契约|誓言|亲密|拥抱|亲吻|撒娇)/;
const SELF_OR_PARTNER = /^(?:我|自己|先生|恋人|伴侣|爱人|我们|彼此)$/;

const GUARD_RULES = Object.freeze([
  {
    reason: "explicit-third-party-subject",
    authority: "raw-query+declared-entities",
    matches: ({ query, entities }) => entities.some((entity) =>
      !SELF_OR_PARTNER.test(entity)
      && query.startsWith(entity)
      && !hasSharedRecollectionIntent(query)),
  },
  {
    reason: "technical-or-meta-intent",
    authority: "raw-query",
    matches: ({ query }) => {
      const technical = TECHNICAL_OR_META.test(query) || AMBIGUOUS_TECHNICAL_NOUN.test(query);
      if (!technical) return false;
      if (OPERATIONAL_REQUEST.test(query)) return true;
      return !hasSharedRecollectionIntent(query);
    },
  },
  {
    reason: "non-relational-task",
    authority: "raw-query",
    matches: ({ query }) => NON_RELATIONAL_TASK.test(query) && !RELATION_CUE.test(query),
  },
]);

export function evaluateSituationGuard(value = {}) {
  const evidence = {
    query: normalize(value.query),
    entities: cleanEntities(value.entities),
  };
  for (const rule of GUARD_RULES) {
    if (rule.matches(evidence)) {
      return { blocked: true, reason: rule.reason, authority: rule.authority };
    }
  }
  return { blocked: false, reason: null, authority: null };
}

function hasSharedRecollectionIntent(query) {
  return EXPLICIT_SHARED_RECOLLECTION.test(query)
    && SHARED_PARTICIPANT.test(query)
    && (SHARED_HISTORY.test(query) || RELATIONAL_CONTENT.test(query));
}

function cleanEntities(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => normalize(item)).filter(Boolean))].slice(0, 12)
    : [];
}

function normalize(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}
