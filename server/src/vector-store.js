import { createHash } from "node:crypto";
import { clampInteger } from "./lib/number.js";
import { vectorEnvValue } from "./vector-settings.js";

const DEFAULT_URL = "http://127.0.0.1:6333";
const DEFAULT_PREFIX = "moss_memories";
const DEFAULT_TIMEOUT_MS = 5000;

export function qdrantConfig({ indexIdentity, dimensions } = {}) {
  const baseUrl = String(vectorEnvValue("MOSS_QDRANT_URL", DEFAULT_URL)).replace(/\/+$/, "");
  const apiKey = String(vectorEnvValue("MOSS_QDRANT_API_KEY", "")).trim();
  const prefix = sanitizeCollectionPart(vectorEnvValue("MOSS_QDRANT_COLLECTION_PREFIX", DEFAULT_PREFIX));
  const suffix = String(indexIdentity || "default").slice(0, 16);
  return {
    baseUrl,
    apiKey,
    collection: `${prefix}_${suffix}`,
    dimensions: Number(dimensions) || 1024,
    timeoutMs: clampInteger(vectorEnvValue("MOSS_QDRANT_TIMEOUT_MS", DEFAULT_TIMEOUT_MS), 1000, 30000, DEFAULT_TIMEOUT_MS),
  };
}

export async function ensureQdrantCollection(config, { fetchImpl = globalThis.fetch } = {}) {
  const existing = await qdrantRequest(config, `/collections/${encodeURIComponent(config.collection)}`, {
    method: "GET", fetchImpl, allow404: true,
  });
  if (existing.status === 404) {
    await qdrantRequest(config, `/collections/${encodeURIComponent(config.collection)}`, {
      method: "PUT",
      fetchImpl,
      body: {
        vectors: { size: config.dimensions, distance: "Cosine" },
        hnsw_config: { m: 16, ef_construct: 200 },
      },
    });
    await qdrantRequest(config, `/collections/${encodeURIComponent(config.collection)}/index?wait=true`, {
      method: "PUT",
      fetchImpl,
      body: { field_name: "memory_id", field_schema: "keyword" },
    });
    return { created: true, collection: config.collection };
  }
  const size = Number(existing.data?.result?.config?.params?.vectors?.size);
  const distance = String(existing.data?.result?.config?.params?.vectors?.distance || "").toLowerCase();
  if (Number.isFinite(size) && size !== config.dimensions) throw qdrantError("collection-dimensions-mismatch");
  if (distance && distance !== "cosine") throw qdrantError("collection-distance-mismatch");
  return { created: false, collection: config.collection };
}

export async function upsertQdrantPoints(config, points, { fetchImpl = globalThis.fetch } = {}) {
  if (!points.length) return { upserted: 0 };
  await qdrantRequest(config, `/collections/${encodeURIComponent(config.collection)}/points?wait=true`, {
    method: "PUT", fetchImpl, body: { points },
  });
  return { upserted: points.length };
}

export async function deleteQdrantPoints(config, pointIds, { fetchImpl = globalThis.fetch } = {}) {
  if (!pointIds.length) return { deleted: 0 };
  await qdrantRequest(config, `/collections/${encodeURIComponent(config.collection)}/points/delete?wait=true`, {
    method: "POST", fetchImpl, body: { points: pointIds },
  });
  return { deleted: pointIds.length };
}

export async function listQdrantCollections(config, { fetchImpl = globalThis.fetch } = {}) {
  const response = await qdrantRequest(config, "/collections", { method: "GET", fetchImpl });
  return response.data.result.collections.map((item) => item.name);
}

export async function deleteQdrantMemories(config, memoryIds, { fetchImpl = globalThis.fetch } = {}) {
  const ids = [...new Set(memoryIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return { deleted_memories: 0 };
  await qdrantRequest(config, `/collections/${encodeURIComponent(config.collection)}/points/delete?wait=true`, {
    method: "POST",
    fetchImpl,
    body: {
      filter: {
        should: ids.map((id) => ({ key: "memory_id", match: { value: id } })),
      },
    },
  });
  return { deleted_memories: ids.length };
}

export async function queryQdrant(config, vector, {
  limit = 24, fetchImpl = globalThis.fetch, memoryIds = null,
} = {}) {
  const filter = memoryFilter(memoryIds);
  if (memoryIds != null && !filter) return [];
  const response = await qdrantRequest(config, `/collections/${encodeURIComponent(config.collection)}/points/query`, {
    method: "POST",
    fetchImpl,
    body: {
      query: Array.from(vector),
      ...(filter ? { filter } : {}),
      limit: Math.max(1, Math.min(100, Number(limit) || 24)),
      with_payload: ["memory_id", "chunk_index", "chunk_kind", "chunk_start", "chunk_end", "content_hash", "status", "sensitivity", "scope", "family_key", "projection_hash"],
      with_vector: false,
      params: { hnsw_ef: 128, exact: false },
    },
  });
  const points = Array.isArray(response.data?.result?.points) ? response.data.result.points : [];
  return points.map((point, index) => ({
    id: String(point.payload?.memory_id || ""),
    point_id: point.id,
    score: Number(point.score) || 0,
    rank: index + 1,
    chunk_index: Number(point.payload?.chunk_index) || 0,
    chunk_kind: String(point.payload?.chunk_kind || "semantic"),
    chunk_start: point.payload?.chunk_start, chunk_end: point.payload?.chunk_end, content_hash: point.payload?.content_hash,
    payload: point.payload || {},
  })).filter((item) => item.id);
}


function memoryFilter(memoryIds) {
  if (memoryIds == null) return null;
  const input = Array.isArray(memoryIds) ? memoryIds : memoryIds instanceof Set ? [...memoryIds] : [memoryIds];
  const ids = [...new Set(input.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 128);
  if (!ids.length) return null;
  return { should: ids.map((id) => ({ key: "memory_id", match: { value: id } })) };
}

export async function deleteQdrantCollection(config, { fetchImpl = globalThis.fetch } = {}) {
  return qdrantRequest(config, `/collections/${encodeURIComponent(config.collection)}`, {
    method: "DELETE", fetchImpl, allow404: true,
  });
}

export async function qdrantHealth(config, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const response = await qdrantRequest(config, "/healthz", { method: "GET", fetchImpl, rawOk: true });
    return { reachable: response.status >= 200 && response.status < 300, status: response.status };
  } catch (error) {
    return { reachable: false, reason: error?.code || "request-failed" };
  }
}

export function qdrantPointId(memoryId, chunkIndex = 0) {
  const hex = createHash("sha256").update(`${String(memoryId)}\n${Number(chunkIndex) || 0}`, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function qdrantRequest(config, path, {
  method = "GET", body, fetchImpl = globalThis.fetch, allow404 = false, rawOk = false,
} = {}) {
  if (typeof fetchImpl !== "function") throw qdrantError("fetch-unavailable");
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) headers["api-key"] = config.apiKey;
  let response;
  try {
    response = await fetchImpl(`${config.baseUrl}${path}`, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw qdrantError("request-failed", error);
  }
  if (allow404 && response.status === 404) return { status: 404, data: null };
  if (!response.ok) {
    const detail = await safeResponseText(response);
    throw qdrantError(`http-${response.status}`, detail);
  }
  if (rawOk) return { status: response.status, data: null };
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  return { status: response.status, data };
}

function qdrantError(code, cause = null) {
  const error = new Error(`Qdrant error: ${code}`);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

async function safeResponseText(response) {
  try { return (await response.text()).slice(0, 1000); } catch { return ""; }
}

function sanitizeCollectionPart(value) {
  return String(value || DEFAULT_PREFIX).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || DEFAULT_PREFIX;
}

