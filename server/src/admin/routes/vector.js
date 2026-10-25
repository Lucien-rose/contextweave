import { performance } from "node:perf_hooks";
import { json, readJson } from "../http.js";
import { createEmbeddings, vectorProviderConfig } from "../../vector-provider.js";
import { vectorRuntimeStatus } from "../../vector-retrieval.js";
import {
  mergeVectorProviderInput, readVectorSettings, saveVectorSettings, vectorAdminEnvFile,
} from "../../vector-settings.js";

const MAX_SETTINGS_BODY = 32 * 1024;
const PROBE_TEXT = "ContextWeave Core semantic retrieval provider health probe.";

export function createVectorRoutes({
  db,
  envPath = vectorAdminEnvFile(),
  probeMemoryMode = defaultProbeMemoryMode,
} = {}) {
  return async function handleVectorRoutes(req, res, requestUrl) {
    const path = requestUrl.pathname;
    if (path === "/api/vector/settings") {
      if (req.method === "GET") return json(res, 200, await vectorSettingsPayload(db, { envPath, probeMemoryMode }));
      if (req.method === "PUT") {
        const input = await readJson(req, MAX_SETTINGS_BODY);
        const settings = saveVectorSettings(input, { envPath });
        const payload = await vectorSettingsPayload(db, { settings, envPath, probeMemoryMode });
        if (input.mode != null && payload.memory_runtime_mode && payload.memory_runtime_mode !== settings.mode) {
          return json(res, 409, {
            error: "Vector mode was persisted, but ContextWeave Core did not adopt the same runtime mode.",
            settings: payload.settings,
            runtime: payload.runtime,
            memory_runtime_mode: payload.memory_runtime_mode,
          });
        }
        return json(res, 200, payload);
      }
      return json(res, 405, { error: "Method not allowed" });
    }
    if (path === "/api/vector/test") {
      if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
      const input = await readJson(req, MAX_SETTINGS_BODY);
      const overrides = mergeVectorProviderInput(input, { envPath });
      const config = vectorProviderConfig(overrides);
      if (!config.available) return json(res, 400, { error: "Embedding API key is not configured" });
      const started = performance.now();
      const [embedding] = await createEmbeddings([PROBE_TEXT], { config });
      return json(res, 200, {
        ok: true,
        provider: config.provider,
        model: config.model,
        dimensions: embedding.length,
        latency_ms: Math.round(performance.now() - started),
      });
    }
    return json(res, 404, { error: "Not found" });
  };
}

async function vectorSettingsPayload(db, {
  settings = null,
  envPath = vectorAdminEnvFile(),
  probeMemoryMode = defaultProbeMemoryMode,
} = {}) {
  const persisted = settings || readVectorSettings({ envPath });
  const runtime = await vectorRuntimeStatus(db, { probe: true });
  const memoryRuntimeMode = await probeMemoryMode();
  return {
    settings: persisted,
    runtime: {
      ...runtime,
      qdrant_memory_limit: persisted.qdrant_memory_limit,
      sync_interval_minutes: persisted.sync_interval_minutes,
    },
    memory_runtime_mode: memoryRuntimeMode,
    mode_consistent: memoryRuntimeMode ? memoryRuntimeMode === persisted.mode : null,
    settings_authority: envPath === vectorAdminEnvFile() ? "admin-vector-env" : "injected",
  };
}

async function defaultProbeMemoryMode() {
  const host = String(process.env.MOSS_HTTP_HOST || "127.0.0.1");
  const port = Number(process.env.MOSS_HTTP_PORT || 2091);
  try {
    const response = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return null;
    const payload = await response.json();
    return ["off", "observe", "on"].includes(payload.vector_mode) ? payload.vector_mode : null;
  } catch {
    return null;
  }
}
