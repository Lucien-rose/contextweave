import { createHash } from "node:crypto";

const PUBLIC_ROLES = new Set(["factual", "supporting", "associative", "ambient", "policy"]);
const PUBLIC_TIERS = new Set(["T0", "T1", "T2"]);
const PUBLIC_CHANNELS = new Set(["formal", "fts", "context-envelope", "situation", "vector", "association"]);

export function projectRecallForPublic(payload, {
  idSalt = "moss-public-v1",
  synthetic = false,
} = {}) {
  const memories = Array.isArray(payload?.memories) ? payload.memories : [];
  if (synthetic) requireSynthetic(memories);
  const projected = memories.map((memory) => publicMemory(memory, { idSalt, synthetic }));
  return {
    schema_version: 1,
    route: publicRoute(payload?.route),
    counts: tierCounts(projected),
    memories: projected,
  };
}

export function projectExpansionForPublic(expansion, {
  idSalt = "moss-public-v1",
  synthetic = false,
} = {}) {
  const item = expansion?.expansion || expansion || {};
  if (synthetic) requireSynthetic([item]);
  return {
    schema_version: 1,
    public_id: publicIdForMemory(item.memory_id, idSalt),
    available: Boolean(item.available),
    detail_level: publicDetail(item.detail_level),
    truncated: Boolean(item.truncated),
    ...(synthetic ? syntheticText(item) : {}),
  };
}

function requireSynthetic(items) {
  if (items.some((item) => item?.demo_synthetic !== true)) {
    throw new Error("Public text projection accepts synthetic demo records only");
  }
}

function publicMemory(memory, { idSalt, synthetic }) {
  const tier = PUBLIC_TIERS.has(memory?.recall_tier) ? memory.recall_tier : null;
  const role = PUBLIC_ROLES.has(memory?.recall_role) ? memory.recall_role : null;
  return {
    public_id: publicIdForMemory(memory?.id, idSalt),
    tier,
    role,
    evidence_type: publicToken(memory?.evidence_type),
    source_channels: (memory?.source_channels || []).filter((item) => PUBLIC_CHANNELS.has(item)),
    score: finiteNumber(memory?.score),
    expandable: Boolean(memory?.expandable),
    content_available: Boolean(memory?.content_available),
    detail_level: publicDetail(memory?.detail_level),
    path_shape: pathShape(tier),
    ...(synthetic ? syntheticText(memory) : {}),
  };
}

function syntheticText(memory) {
  return {
    title: cleanSynthetic(memory?.title, 160),
    excerpt: cleanSynthetic(memory?.excerpt || memory?.content, 360),
    recall_path: (memory?.recall_path || []).map((item) => cleanSynthetic(item, 160)).filter(Boolean).slice(0, 6),
  };
}

export function publicIdForMemory(value, salt = "moss-public-v1") {
  return createHash("sha256").update(`${salt}:${String(value || "missing")}`, "utf8").digest("hex").slice(0, 16);
}

function publicRoute(value) {
  return ["RECALL", "VERIFY", "NO_RECALL"].includes(value) ? value : "RECALL";
}

function publicDetail(value) {
  return ["summary", "cue", "sealed", "safe_projection", "relevant_chunk", "full"].includes(value) ? value : null;
}

function publicToken(value) {
  const token = String(value || "").trim();
  return /^[a-z0-9_-]{1,64}$/i.test(token) ? token : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function cleanSynthetic(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function pathShape(tier) {
  if (tier === "T0") return ["query", "direct"];
  if (tier === "T1") return ["query", "one-hop"];
  if (tier === "T2") return ["query", "qualified-seed", "association", "sidecar"];
  return ["query", "unqualified"];
}

function tierCounts(memories) {
  const counts = { T0: 0, T1: 0, T2: 0 };
  for (const memory of memories) if (Object.hasOwn(counts, memory.tier)) counts[memory.tier] += 1;
  return counts;
}
