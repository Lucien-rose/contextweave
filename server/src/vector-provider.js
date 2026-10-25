import { createHash } from "node:crypto";
import { clampInteger } from "./lib/number.js";
import { vectorEnvValue } from "./vector-settings.js";
import { resolveModelRoute } from "./models/settings.js";
import { connectionEmbeddings } from "./models/embeddings.js";
import { modelFetch } from "./models/transport.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "text-embedding-3-large";
const DEFAULT_DIMENSIONS = 1024;
const DEFAULT_TIMEOUT_MS = 20000;

export function vectorProviderConfig(overrides = {}) {
  const connection = resolveModelRoute("embedding");
  const baseUrl = String(overrides.baseUrl ?? connection?.base_url ?? vectorEnvValue("MOSS_EMBEDDING_BASE_URL", DEFAULT_BASE_URL)).replace(/\/+$/, "");
  const model = String(overrides.model ?? connection?.model ?? vectorEnvValue("MOSS_EMBEDDING_MODEL", DEFAULT_MODEL)).trim() || DEFAULT_MODEL;
  const dimensions = clampInteger(overrides.dimensions ?? connection?.dimensions ?? vectorEnvValue("MOSS_EMBEDDING_DIMENSIONS", DEFAULT_DIMENSIONS), 64, 8192, DEFAULT_DIMENSIONS);
  const apiKey = String(overrides.apiKey ?? connection?.api_key ?? vectorEnvValue("MOSS_EMBEDDING_API_KEY", process.env.OPENAI_API_KEY || "")).trim();
  const isOpenAI = /^https:\/\/api\.openai\.com(?:\/|$)/i.test(baseUrl);
  const dimensionsMode = String(overrides.includeDimensionsMode ?? vectorEnvValue("MOSS_EMBEDDING_INCLUDE_DIMENSIONS", "auto")).toLowerCase();
  const includeDimensions = overrides.includeDimensionsMode == null && connection ? connection.include_dimensions
    : dimensionsMode === "1" || dimensionsMode === "true" || (dimensionsMode === "auto" && isOpenAI);
  return {
    baseUrl,
    model,
    dimensions,
    apiKey,
    includeDimensions,
    available: Boolean(apiKey) || !isOpenAI,
    provider: connection?.protocol === "google" ? "google" : isOpenAI ? "openai" : "openai-compatible",
    ...(connection ? { connection } : {}),
    timeoutMs: clampInteger(overrides.timeoutMs ?? connection?.timeout_ms ?? vectorEnvValue("MOSS_EMBEDDING_TIMEOUT_MS", DEFAULT_TIMEOUT_MS), 1000, 120000, DEFAULT_TIMEOUT_MS),
  };
}

export async function createEmbeddings(texts, { fetchImpl = modelFetch, config = vectorProviderConfig() } = {}) {
  if (!Array.isArray(texts) || !texts.length) return [];
  if (config.connection) return connectionEmbeddings({ ...config.connection, base_url: config.baseUrl,
    api_key: config.apiKey, model: config.model, dimensions: config.dimensions, include_dimensions: config.includeDimensions,
    timeout_ms: config.timeoutMs }, texts, { fetchImpl });
  if (!config.available) throw providerError("missing-api-key");
  if (typeof fetchImpl !== "function") throw providerError("fetch-unavailable");
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  let response;
  try {
    response = await fetchImpl(`${config.baseUrl}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        input: texts,
        encoding_format: "float",
        ...(config.includeDimensions ? { dimensions: config.dimensions } : {}),
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    throw providerError("request-failed", error);
  }
  if (!response.ok) {
    const detail = await safeResponseText(response);
    throw providerError(`http-${response.status}`, detail);
  }
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  if (rows.length !== texts.length) throw providerError("unexpected-vector-count");
  return [...rows]
    .sort((a, b) => Number(a.index) - Number(b.index))
    .map((row) => normalizeVector(row.embedding, config.dimensions));
}

export function providerIdentity(config = vectorProviderConfig()) {
  return createHash("sha256")
    .update(`${config.provider}\n${config.baseUrl}\n${config.model}\n${config.dimensions}`, "utf8")
    .digest("hex");
}

function normalizeVector(value, dimensions) {
  if (!Array.isArray(value) || value.length !== dimensions) throw providerError("unexpected-vector-dimensions");
  const vector = new Float32Array(dimensions);
  let magnitude = 0;
  for (let index = 0; index < dimensions; index += 1) {
    const number = Number(value[index]);
    if (!Number.isFinite(number)) throw providerError("non-finite-vector");
    vector[index] = number;
    magnitude += number * number;
  }
  const norm = Math.sqrt(magnitude);
  if (!(norm > 0)) throw providerError("zero-vector");
  for (let index = 0; index < dimensions; index += 1) vector[index] /= norm;
  return vector;
}


function providerError(code, cause = null) {
  const error = new Error(`Embedding provider error: ${code}`);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

async function safeResponseText(response) {
  try { return (await response.text()).slice(0, 1000); } catch { return ""; }
}
