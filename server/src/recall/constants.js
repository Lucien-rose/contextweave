import { recallProfile } from "./profile.js";

const LOCAL_PROFILE = recallProfile();

export const INTIMATE_QUERY_MARKERS = [
  "亲密", "情欲", "协议", "契约", "条款", "约定", "誓言", "盟誓", "做爱", "身体", "调教", "高潮",
  "奶嘴", "自慰", "初夜", "撒娇", "想你", "我们之间", "还记得", "继续",
];

export const GENERAL_DEEP_CATEGORIES = ["identity", "agreement", "project", "handoff"];
export const MIN_RELEVANCE_SCORE = 3;
export const INTIMATE_CATEGORY_QUERIES = ["私密内容", "私密记忆", "亲密内容", "亲密记忆"];
export const GENERIC_IDENTITY_CUES = new Set(LOCAL_PROFILE.identity_cues);
export const GENERIC_QUERY_TERMS = new Set([
  "什么", "怎么", "怎样", "为什么", "是否", "是不是", "我们", "你们", "他们", "现在", "当前", "之前",
  "过去", "今天", "昨天", "最近", "继续", "相关", "内容", "事情", "东西", "一下", "一个", "这个", "那个",
  "可以", "需要", "记忆", "回忆", ...LOCAL_PROFILE.generic_query_terms,
]);
export const GENERIC_QUERY_PHRASES = new Set([
  ...GENERIC_QUERY_TERMS,
  ...GENERIC_IDENTITY_CUES,
  "还记得吗", "还记得", "记得吗", "记得", "请读取", "请查找", "请找回", "帮我", "告诉我",
  "我们之间", "我们的", "你们的", "他们的", "只为", "这条", "那条", "这份", "那份", "而", "的", "吗",
]);
export const RELATIVE_TAIL_RATIO = 0.2;
export const MAX_RELATIVE_RELEVANCE_FLOOR = 12;
export const CONTEXTUAL_TAIL_RATIO = 0.75;
export const MAX_CONTEXTUAL_RELEVANCE_FLOOR = 16;
export const MAX_CONTEXT_HYPOTHESES = 3;
export const MAX_CONTEXT_DESCRIPTOR_ITEMS = 12;
export const SITUATION_ACTIVATION_CONFIDENCE_RATIO = 0.75;
export const ACTIVATION_RRF_K = 60;
export const ACTIVATION_RRF_WEIGHTS = Object.freeze({ formal: 1, situation: 1.25, vector: 1.5 });
export const GENERIC_CONTEXT_EVIDENCE_PHRASES = new Set([
  ...GENERIC_QUERY_PHRASES,
  "存在关于", "可能存在", "希望想起", "对应条款", "长期约定", "长期关系",
  "私人关系", "亲密互动", "主动履行", "当前正在", "向恋人", "恋人", "长期",
  ...LOCAL_PROFILE.context_evidence_phrases,
  "约定", "协议", "条款", "亲密", "互动", "关系", "请求", "主动", "希望", "存在", "关于",
  "对应", "想起", "履行", "当前", "正在", "记忆", "事情", "状态", "进行", "应如何", "如何",
  "处理", "有关", "可能", "回应",
]);
export const TECHNICAL_MARKERS = [
  /\bsqlite\b/i, /\bschema\b/i, /\bmcp\b/i, /\bnpm\b/i, /\bnode(?:\.js)?\b/i,
  /\bjavascript\b/i, /\btypescript\b/i, /\bapi\b/i, /\bserver\b/i, /\bhotfix\b/i,
  /数据库/, /部署/, /测试/, /代码/, /修复/, /版本/, /安装/, /日志/, /配置/, /迁移/, /回滚/, /发布/, /验收/,
];
export const WORD_SEGMENTER = new Intl.Segmenter("zh-CN", { granularity: "word" });


export const SITUATION_PROJECTION_GENERATION = "situation-v2.1";
