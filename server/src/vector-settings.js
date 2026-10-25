import { fchmodSync, fstatSync, existsSync, openSync, closeSync, ftruncateSync, fsyncSync, readFileSync, writeFileSync } from "node:fs";

export const DEFAULT_VECTOR_ENV_FILE = "/etc/moss-memory/vector.env";
const DEFAULTS = Object.freeze({
  MOSS_RECALL_VECTOR_MODE: "off",
  MOSS_QDRANT_URL: "http://127.0.0.1:6333",
  MOSS_QDRANT_COLLECTION_PREFIX: "moss_memories",
  MOSS_QDRANT_TIMEOUT_MS: "5000",
  MOSS_QDRANT_MEMORY_LIMIT: "512m",
  MOSS_EMBEDDING_BASE_URL: "https://api.openai.com/v1",
  MOSS_EMBEDDING_MODEL: "text-embedding-3-large",
  MOSS_EMBEDDING_DIMENSIONS: "1024",
  MOSS_EMBEDDING_INCLUDE_DIMENSIONS: "auto",
  MOSS_EMBEDDING_TIMEOUT_MS: "20000",
  MOSS_VECTOR_BODY_POLICY: "private",
  MOSS_VECTOR_TOP_K: "24",
  MOSS_VECTOR_MIN_SIMILARITY: "0.32",
  MOSS_VECTOR_RELATIVE_RATIO: "0.78",
  MOSS_VECTOR_SYNC_BATCH: "32",
  MOSS_VECTOR_REQUEST_SYNC_BATCH: "4",
  MOSS_VECTOR_EMBED_BATCH: "64",
  MOSS_VECTOR_CHUNK_CHARS: "4000",
  MOSS_VECTOR_CHUNK_OVERLAP: "320",
  MOSS_VECTOR_MAX_CHUNKS: "16",
});

export const VECTOR_BODY_POLICIES = Object.freeze(["metadata", "private", "non-intimate", "all"]);

export function normalizeVectorBodyPolicy(value) {
  return value === "none" ? "metadata" : value;
}

export function vectorEnvFile() {
  return String(process.env.MOSS_VECTOR_ENV_FILE || DEFAULT_VECTOR_ENV_FILE);
}


export function vectorAdminEnvFile() {
  return String(process.env.MOSS_VECTOR_ADMIN_ENV_FILE || DEFAULT_VECTOR_ENV_FILE);
}

export function vectorEnvValue(key, fallback = "") {
  return vectorEnvValueFrom(vectorEnvFile(), key, fallback);
}

export function vectorEnvValueFrom(envPath, key, fallback = "") {
  const fileValue = loadVectorEnv(envPath).get(key);
  if (fileValue != null && fileValue !== "") return fileValue;
  const processValue = process.env[key];
  if (processValue != null && processValue !== "") return String(processValue);
  if (Object.hasOwn(DEFAULTS, key)) return DEFAULTS[key];
  return fallback;
}

export function readVectorSettings({ envPath = vectorEnvFile() } = {}) {
  const values = loadVectorEnv(envPath);
  const value = (key) => values.get(key) ?? process.env[key] ?? DEFAULTS[key] ?? "";
  const configuredKey = Boolean(values.get("MOSS_EMBEDDING_API_KEY") || process.env.MOSS_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY);
  return {
    installed: existsSync(envPath),
    mode: oneOf(value("MOSS_RECALL_VECTOR_MODE"), ["off", "observe", "on"], "off"),
    qdrant_url: value("MOSS_QDRANT_URL"),
    qdrant_collection_prefix: value("MOSS_QDRANT_COLLECTION_PREFIX"),
    qdrant_memory_limit: value("MOSS_QDRANT_MEMORY_LIMIT"),
    embedding_base_url: value("MOSS_EMBEDDING_BASE_URL"),
    embedding_model: value("MOSS_EMBEDDING_MODEL"),
    embedding_dimensions: toInteger(value("MOSS_EMBEDDING_DIMENSIONS"), 1024),
    embedding_include_dimensions: value("MOSS_EMBEDDING_INCLUDE_DIMENSIONS"),
    body_policy: oneOf(normalizeVectorBodyPolicy(value("MOSS_VECTOR_BODY_POLICY")), VECTOR_BODY_POLICIES, "private"),
    api_key_configured: configuredKey,
    api_key_source: values.get("MOSS_EMBEDDING_API_KEY") ? "vector-env"
      : process.env.MOSS_EMBEDDING_API_KEY ? "process-env"
      : process.env.OPENAI_API_KEY ? "openai-env" : null,
    sync_interval_minutes: 5,
  };
}

export function saveVectorSettings(input = {}, { envPath = vectorEnvFile() } = {}) {
  if (!existsSync(envPath)) {
    const error = new Error("Vector settings are not installed yet. Run moss-vector-install first.");
    error.statusCode = 409;
    error.publicMessage = error.message;
    throw error;
  }
  const patch = new Map();
  if (input.mode != null) patch.set("MOSS_RECALL_VECTOR_MODE", oneOf(String(input.mode), ["off", "observe", "on"], null, "Invalid vector mode"));
  if (input.embedding_base_url != null) patch.set("MOSS_EMBEDDING_BASE_URL", cleanUrl(input.embedding_base_url));
  if (input.embedding_model != null) patch.set("MOSS_EMBEDDING_MODEL", cleanLine(input.embedding_model, 160, "Embedding model"));
  if (input.embedding_dimensions != null) patch.set("MOSS_EMBEDDING_DIMENSIONS", String(integerInRange(input.embedding_dimensions, 64, 3072, "Embedding dimensions")));
  if (input.embedding_include_dimensions != null) patch.set("MOSS_EMBEDDING_INCLUDE_DIMENSIONS", oneOf(String(input.embedding_include_dimensions), ["auto", "true", "false", "1", "0"], null, "Invalid dimensions mode"));
  if (input.body_policy != null) patch.set("MOSS_VECTOR_BODY_POLICY", oneOf(normalizeVectorBodyPolicy(String(input.body_policy)), VECTOR_BODY_POLICIES, null, "Invalid body policy"));
  if (input.api_key != null && String(input.api_key).trim()) patch.set("MOSS_EMBEDDING_API_KEY", cleanLine(input.api_key, 512, "API key"));
  if (input.clear_api_key === true) patch.set("MOSS_EMBEDDING_API_KEY", null);

  const current = readFileSync(envPath, "utf8");
  const next = updateEnvText(current, patch);
  writeExistingFile(envPath, next);
  return readVectorSettings({ envPath });
}

export function mergeVectorProviderInput(input = {}, { envPath = vectorEnvFile() } = {}) {
  const current = readVectorSettings({ envPath });
  return {
    baseUrl: input.embedding_base_url == null ? current.embedding_base_url : cleanUrl(input.embedding_base_url),
    model: input.embedding_model == null ? current.embedding_model : cleanLine(input.embedding_model, 160, "Embedding model"),
    dimensions: input.embedding_dimensions == null ? current.embedding_dimensions : integerInRange(input.embedding_dimensions, 64, 3072, "Embedding dimensions"),
    apiKey: String(input.api_key || "").trim() || vectorEnvValueFrom(envPath, "MOSS_EMBEDDING_API_KEY", process.env.OPENAI_API_KEY || ""),
    includeDimensionsMode: input.embedding_include_dimensions == null ? current.embedding_include_dimensions : String(input.embedding_include_dimensions),
  };
}

function loadVectorEnv(envPath = vectorEnvFile()) {
  if (!existsSync(envPath)) return new Map();
  return parseEnv(readFileSync(envPath, "utf8"));
}

function parseEnv(text) {
  const map = new Map();
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (!/^[A-Z0-9_]+$/.test(key)) continue;
    map.set(key, line.slice(index + 1));
  }
  return map;
}

function updateEnvText(text, patch) {
  if (!patch.size) return String(text || "");
  const seen = new Set();
  const lines = String(text || "").split(/\r?\n/).filter((line, index, all) => index < all.length - 1 || line !== "");
  const updated = [];
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=/);
    const key = match?.[1];
    if (!key || !patch.has(key)) { updated.push(line); continue; }
    seen.add(key);
    const value = patch.get(key);
    if (value != null) updated.push(`${key}=${value}`);
  }
  for (const [key, value] of patch) if (!seen.has(key) && value != null) updated.push(`${key}=${value}`);
  return `${updated.join("\n")}\n`;
}

function writeExistingFile(path, content) {
  const fd = openSync(path, "r+");
  try {
    ftruncateSync(fd, 0);
    writeFileSync(fd, content, { encoding: "utf8" });
    fchmodSync(fd, 0o600 | (fstatSync(fd).mode & 0o040));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function cleanLine(value, maxLength, label) {
  const result = String(value ?? "").trim();
  if (!result) throw publicError(`${label} is required`);
  if (/\r|\n/.test(result)) throw publicError(`${label} must be one line`);
  if (result.length > maxLength) throw publicError(`${label} is too long`);
  return result;
}

function cleanUrl(value) {
  const result = cleanLine(value, 500, "Embedding base URL").replace(/\/+$/, "");
  let parsed;
  try { parsed = new URL(result); } catch { throw publicError("Embedding base URL is invalid"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw publicError("Embedding base URL must use http or https");
  return result;
}

function integerInRange(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw publicError(`${label} must be between ${min} and ${max}`);
  return number;
}

function oneOf(value, allowed, fallback, message = "Invalid value") {
  return allowed.includes(value) ? value : fallback != null ? fallback : (() => { throw publicError(message); })();
}

function toInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function publicError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.publicMessage = message;
  return error;
}
