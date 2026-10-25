import { performance } from "node:perf_hooks";
import { createModelSettingsStore, connectionFingerprint } from "./settings.js";
import { generateStructured } from "./client.js";
import { connectionEmbeddings } from "./embeddings.js";
import { requestJevDecisions } from "../jev/client.js";
import { providerIdentity, vectorProviderConfig } from "../vector-provider.js";
import { publicError } from "../lib/error.js";

export function createModelService({ db, store = createModelSettingsStore(), fetchImpl } = {}) {
  return {
    list: store.list, routes: store.routes, remove: store.remove,
    save(input, id) { return store.save(input, id); },
    async test(id, capability = "generate") {
      const connection = store.get(id);
      if (!connection.capabilities.includes(capability)) throw publicError("Connection lacks requested capability");
      const fingerprint = connectionFingerprint(connection);
      const started = performance.now();
      if (capability === "embedding") await connectionEmbeddings(connection, ["ContextWeave connection test"], { fetchImpl });
      else if (capability === "decisions") {
        const result = await requestJevDecisions({ state: { test: true }, questions: { probe: { type: "choice", criteria: { ok: "Select ok" } } } },
          { config: { baseUrl: connection.base_url, model: connection.model, apiKey: connection.api_key,
            timeoutMs: connection.timeout_ms, connection }, fetchImpl });
        if (result.answers.probe?.choice !== "ok") throw publicError("Decision probe did not return ok", 502);
      } else {
        const result = await generateStructured(connection, { instruction: "Return {ok:true}.", input: { test: true },
          schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } } }, { fetchImpl });
        if (result.value?.ok !== true) throw publicError("Model connection probe did not return ok", 502);
      }
      store.markTested(id, fingerprint, capability);
      return { ok: true, model: connection.model, capability, latency_ms: Math.round(performance.now() - started) };
    },
    setRoute(task, id) {
      if (task === "embedding" && db?.prepare("SELECT 1 FROM memory_vector_state LIMIT 1").get()) {
        const previous = vectorProviderConfig();
        const next = id ? store.get(id) : null;
        const nextIdentity = next ? providerIdentity({ provider: next.protocol === "google" ? "google"
          : /^https:\/\/api\.openai\.com(?:\/|$)/i.test(next.base_url) ? "openai" : "openai-compatible",
          baseUrl: next.base_url, model: next.model, dimensions: next.dimensions }) : null;
        if (!nextIdentity || nextIdentity !== providerIdentity(previous)) {
          throw publicError("Embedding space change requires blue/green migration via /api/vector/migration/start; saved connection is available for testing", 409);
        }
      }
      return store.setRoute(task, id);
    },
  };
}

