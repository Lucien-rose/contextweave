import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statSync, chownSync } from "node:fs";
import { dirname, join } from "node:path";
import { connectionSchema, supportsTask, TASKS } from "./contract.js";
import { parseContract } from "../lib/contract.js";
import { publicError } from "../lib/error.js";

export function modelSettingsPaths() {
  const directory = process.env.MOSS_CONFIG_DIR || "/etc/moss-memory";
  return { path: process.env.MOSS_MODEL_SETTINGS_FILE || join(directory, "models/connections.json"),
    keyPath: process.env.MOSS_MODEL_KEY_FILE || join(directory, "models.key") };
}

export function connectionFingerprint(connection) {
  const { tested, api_key, ...config } = connection;
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

export function createModelSettingsStore(paths = modelSettingsPaths()) {
  const read = () => existsSync(paths.path) ? JSON.parse(readFileSync(paths.path, "utf8")) : { connections: {}, routes: {} };
  const key = () => {
    if (!existsSync(paths.keyPath)) throw publicError("Model secret key file is not installed", 503);
    const value = Buffer.from(readFileSync(paths.keyPath, "utf8").trim(), "hex");
    if (value.length !== 32) throw publicError("Invalid model secret key file", 503);
    return value;
  };
  const write = (state) => {
    mkdirSync(dirname(paths.path), { recursive: true, mode: 0o700 });
    const temp = `${paths.path}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(state), { mode: 0o600, flag: "wx" });
    if (process.getuid?.() === 0) {
      const directory = statSync(dirname(paths.path));
      chownSync(temp, directory.uid, directory.gid);
    }
    renameSync(temp, paths.path);
  };
  const get = (id) => {
    const connections = read().connections;
    const row = Object.hasOwn(connections, id) ? connections[id] : null;
    if (!row) throw publicError("Model connection not found", 404);
    return { ...row, api_key: decrypt(row.secret, key()) };
  };
  return {
    seal: (value) => encrypt(JSON.stringify(value), key()),
    unseal: (value) => JSON.parse(decrypt(value, key())),
    list: () => Object.values(read().connections).map(publicConnection),
    routes: () => read().routes,
    get,
    resolve(task) {
      const id = read().routes[task];
      return id ? get(id) : null;
    },
    save(input, id = randomUUID()) {
      const parsed = parseContract(connectionSchema, input);
      const url = new URL(parsed.base_url);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw publicError("API base must be an HTTP(S) URL without credentials, query or fragment");
      }
      if (url.protocol !== "https:" && process.env.MOSS_MODELS_ALLOW_PRIVATE !== "1") {
        throw publicError("HTTPS is required; local providers require server-side opt-in");
      }
      validateCapabilities(parsed);
      const state = read();
      const previous = state.connections[id];
      if (!/^[a-zA-Z0-9-]{1,160}$/.test(id)) throw publicError("Invalid connection ID");
      if (!parsed.api_key && !previous?.secret) throw publicError("API key is required");
      const { api_key, ...config } = parsed;
      const row = { ...config, base_url: parsed.base_url.replace(/\/+$/, ""), id,
        secret: api_key ? encrypt(api_key, key()) : previous.secret };
      if (previous && state.routes.embedding === id && embeddingSpace(previous) !== embeddingSpace(row)) {
        throw publicError("Active embedding space is immutable until blue/green migration is available", 409);
      }
      if (previous && Object.values(state.routes).includes(id)) {
        const comparable = ({ secret, tested, ...value }) => JSON.stringify(value);
        if (comparable(previous) !== comparable(row)) throw publicError("Create and test a replacement before changing an assigned connection", 409);
      }
      state.connections[id] = row;
      write(state);
      return publicConnection(row);
    },
    markTested(id, fingerprint, capability) {
      const state = read();
      const row = state.connections[id];
      if (!row || connectionFingerprint(row) !== fingerprint) throw publicError("Connection changed during test", 409);
      row.tested = { ...(row.tested || {}), [capability]: fingerprint };
      write(state);
      return publicConnection(row);
    },
    setRoute(task, id) {
      if (!TASKS.includes(task)) throw publicError("Unknown model task");
      const state = read();
      if (id === null) delete state.routes[task];
      else {
        const row = Object.hasOwn(state.connections, id) ? state.connections[id] : null;
        if (!row || !supportsTask(row, task)) throw publicError("Connection does not support this task");
        const capability = task === "embedding" ? "embedding" : row.protocol === "decisions" ? "decisions" : "generate";
        if (row.tested?.[capability] !== connectionFingerprint(row)) throw publicError("Test this connection before activating it", 409);
        state.routes[task] = id;
      }
      write(state);
      return state.routes;
    },
    remove(id) {
      const state = read();
      if (Object.values(state.routes).includes(id)) throw publicError("Connection is assigned to an active task", 409);
      delete state.connections[id];
      write(state);
      return { deleted: true };
    },
  };
}

export const resolveModelRoute = (task) => createModelSettingsStore().resolve(task);

export function embeddingSpace(row) {
  return JSON.stringify([row.protocol, row.base_url, row.model, row.dimensions, row.include_dimensions]);
}

function validateCapabilities(row) {
  const allowed = row.protocol === "decisions" ? ["decisions"]
    : row.protocol === "anthropic" ? ["generate"] : ["generate", "embedding"];
  if (row.capabilities.some((capability) => !allowed.includes(capability))) throw publicError("Unsupported protocol capability");
  if (row.capabilities.includes("embedding") && !row.dimensions) throw publicError("Embedding dimensions are required");
}

function publicConnection({ secret, api_key, ...row }) {
  return { ...row, key_configured: Boolean(secret) };
}

function encrypt(text, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64")).join(".");
}

function decrypt(secret, key) {
  const [iv, tag, body] = secret.split(".").map((part) => Buffer.from(part, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", key, iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8");
}
