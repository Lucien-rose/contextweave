import { publicError } from "../lib/error.js";

const NOTION_API = "https://api.notion.com/v1";
const DEFAULT_API_VERSION = "2026-03-11";
const CATEGORY_NAMES = Object.freeze({
  memory: "Memory",
  retrieval: "Retrieval",
  sync: "Sync",
  architecture: "Architecture",
  admin: "Admin",
  frontend: "Frontend",
  other: "Other",
});

export function notionReviewConfig(env = process.env) {
  return {
    token: String(env.MOSS_NOTION_TOKEN || "").trim(),
    dataSourceId: String(env.MOSS_NOTION_DATA_SOURCE_ID || "").trim(),
    apiVersion: String(env.MOSS_NOTION_API_VERSION || DEFAULT_API_VERSION).trim(),
  };
}

export async function writeDeferredReview(review, input, {
  fetchImpl = globalThis.fetch,
  config = notionReviewConfig(),
} = {}) {
  if (!config.token || !config.dataSourceId) {
    throw publicError("Notion deferred-review export is not configured", 409);
  }
  if (typeof fetchImpl !== "function") throw publicError("Notion transport is unavailable", 503);

  const deferredAt = new Date().toISOString();
  const properties = notionProperties(input, deferredAt);
  const response = await fetchImpl(`${NOTION_API}/pages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      "Notion-Version": config.apiVersion,
    },
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: config.dataSourceId },
      properties,
      children: notionBody(review, input),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await readPayload(response);
  if (!response.ok || !payload.id) {
    throw publicError(`Notion export failed${payload.message ? `: ${payload.message}` : ""}`, 502);
  }
  return { page_id: payload.id, url: payload.url || null };
}

function notionProperties(input, deferredAt) {
  return {
    Name: title(input.name),
    "Review ID": richText(input.review_id),
    Category: { select: { name: CATEGORY_NAMES[input.category] } },
    Priority: { select: { name: input.priority } },
    "Deferred At": { date: { start: deferredAt } },
    ...(input.next_review ? { "Next Review": { date: { start: input.next_review } } } : {}),
    "Related Version": richText(input.related_version || ""),
    "Source Component": richText(input.source_component || ""),
  };
}

function notionBody(review, input) {
  return [
    heading("问题摘要"), paragraph(input.summary),
    heading("进入审阅的原因"), paragraph(review.reason),
    heading("暂不处理的原因"), paragraph(input.why_deferred),
    heading("重新考虑条件"), paragraph(input.reconsider_when),
    { object: "block", type: "divider", divider: {} },
    paragraph(`ContextWeave review: ${review.review_id}\nLineage: ${review.family_key}`),
  ];
}

function heading(content) {
  return { object: "block", type: "heading_2", heading_2: { rich_text: text(content) } };
}

function paragraph(content) {
  return { object: "block", type: "paragraph", paragraph: { rich_text: text(content) } };
}

function title(content) {
  return { title: text(content) };
}

function richText(content) {
  return { rich_text: text(content) };
}

function text(content) {
  const value = String(content || "");
  if (!value) return [];
  const parts = [];
  for (let offset = 0; offset < value.length; offset += 2000) {
    parts.push({ type: "text", text: { content: value.slice(offset, offset + 2000) } });
  }
  return parts;
}

async function readPayload(response) {
  try { return await response.json(); } catch { return {}; }
}
