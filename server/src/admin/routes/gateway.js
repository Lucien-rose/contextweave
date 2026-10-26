import { defaults } from "../../defaults.js";
import { RECALL_CONTROL_MODES } from "../../recall/control.js";
import { recallResponse } from "../../recall/response.js";
import { readRecallSettings, saveRecallSettings } from "../../recall/settings.js";
import { INTIMACY_MODES } from "../../recall/modes.js";
import {
  badRequest, clampInteger, cleanOptional, cleanRequired, emptyHomecomingBundle, json,
  optionalContextEnvelope, optionalStringArray, pick, publicCandidate, publicMemory, readJson,
} from "../http.js";

export function createGatewayRoutes({ memoryCore, continuityCore, db }) {
  return async function handleGatewayRoutes(req, res, requestUrl) {
    const path = requestUrl.pathname;
  if (path === "/api/gateway/recall-settings") {
    if (req.method === "GET") return json(res, 200, { settings: readRecallSettings(db) });
    if (req.method === "PUT") return json(res, 200, { settings: saveRecallSettings(db, await readJson(req)) });
  }
  if (req.method === "GET" && path === "/api/gateway/status") {
    const candidates = memoryCore.candidates({ status: "all", limit: 250 });
    const statuses = {};
    for (const candidate of candidates) statuses[candidate.status] = (statuses[candidate.status] || 0) + 1;
    return json(res, 200, {
      gateway: {
        schema_version: 2,
        mode: "continuity-bridge",
        automatic_writes: true,
        model_distiller: false,
        thresholds: { confidence: 0.85, meaning_score: 0.6 },
        candidates: { total: candidates.length, statuses },
        policy_audit: memoryCore.policyAudit(),
      },
      continuity: continuityCore.status(),
    });
  }
  if (req.method === "POST" && path === "/api/gateway/bootstrap") {
    const input = await readJson(req);
    if (input.schema_version != null && ![2, 3].includes(input.schema_version)) throw badRequest("Unsupported homecoming schema version");
    const audience = pick(input.audience, ["private", "public", "third-party"], "private");
    const context = pick(input.context, ["general", "private", "intimate"], "private");
    const intimacyMode = pick(input.intimacy_mode, INTIMACY_MODES, "off");
    if (audience !== "private") {
      return json(res, 200, emptyHomecomingBundle({ context: "general", intimacyMode: "off" }));
    }
    const bundle = memoryCore.bootstrap({
      schemaVersion: input.schema_version === 3 ? 3 : 2,
      totalBudgetChars: input.total_budget_chars,
      deliveryMode: deliveryMode(input),
      query: cleanOptional(input.current_message, 4000) || "",
      context,
      intimacyMode,
      recentlyReadIds: optionalStringArray(input.recently_read_ids, 100, 240),
      recentlyReadHashes: optionalStringArray(input.recently_read_hashes, 100, 160),
      recentlyReadFamilies: optionalStringArray(input.recently_read_families, 100, 240),
      contextEnvelope: optionalContextEnvelope(input.context_envelope),
      contentBudget: input.content_budget == null ? defaults.mainChars : clampInteger(input.content_budget, 1000, 20000),
    });
    if (bundle.schema_version === 3) return json(res, 200, bundle);
    bundle.memories = bundle.memories.slice(0, input.limit == null ? 8 : clampInteger(input.limit, 3, 12));
    return json(res, 200, {
      ...bundle,
      guidance: "Read deep items as continuity, use summaries and agreements as standing context, and mention only what belongs naturally.",
    });
  }
  if (req.method === "POST" && path === "/api/gateway/today") {
    const input = await readJson(req);
    const audience = pick(input.audience, ["private", "public", "third-party"], "private");
    if (audience !== "private") return json(res, 200, { memories: [], guidance: "audience-gated" });
    if (input.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw badRequest("Invalid date");
    return json(res, 200, memoryCore.todayForDelivery({
      date: input.date,
      days: input.days_ahead == null ? 7 : clampInteger(input.days_ahead, 0, 31),
      context: pick(input.context, ["general", "private", "intimate"], "private"),
      intimacyMode: pick(input.intimacy_mode, INTIMACY_MODES, "off"),
      deliveryMode: deliveryMode(input),
      recentlyReadIds: optionalStringArray(input.recently_read_ids, 100, 240),
      recentlyReadHashes: optionalStringArray(input.recently_read_hashes, 100, 160),
      recentlyReadFamilies: optionalStringArray(input.recently_read_families, 100, 240),
    }));
  }
  if (req.method === "POST" && path === "/api/gateway/recall") {
    const input = await readJson(req);
    const audience = pick(input.audience, ["private", "public", "third-party"], "private");
    const query = cleanRequired(input.query, "query", 4000);
    if (audience !== "private") {
      return json(res, 200, { query, route: "NO_RECALL", verification: null, memories: [], guidance: "audience-gated" });
    }
    const context = pick(input.context, ["general", "private", "intimate"], "private");
    const intimacyMode = pick(input.intimacy_mode, INTIMACY_MODES, "off");
    if (input.delivery_mode != null && !["immediate", "confirmed"].includes(input.delivery_mode)) {
      throw badRequest("Invalid delivery mode");
    }
    if (input.vector_mode != null && !["off", "observe", "on"].includes(input.vector_mode)) {
      throw badRequest("Invalid vector mode");
    }
    let hostStatus = null;
    const recalled = await memoryCore.recallForDelivery({
        recallScope: input.recall_scope, jevMode: input.jev_mode,
        onRecallStatus: status => { hostStatus = status; },
        deliveryMode: pick(input.delivery_mode, ["immediate", "confirmed"], "immediate"),
        query,
        context,
        intimacyMode,
        limit: input.limit == null ? defaults.recallItems : clampInteger(input.limit, 1, 12),
        contextBudgetChars: input.context_budget_chars == null
          ? defaults.mainChars
          : clampInteger(input.context_budget_chars, 1200, 12000),
        includeArchived: input.include_archived !== false,
        recentlyReadIds: optionalStringArray(input.recently_read_ids, 100, 240),
        recentlyReadHashes: optionalStringArray(input.recently_read_hashes, 100, 160),
        recentlyReadFamilies: optionalStringArray(input.recently_read_families, 100, 240),
        queryRepresentation: input.query_representation,
        backgroundLimit: input.background_limit,
        backgroundBudgetChars: input.background_budget_chars,
        totalBudgetChars: input.total_budget_chars,
        cueNeighborhoodMode: pick(input.cue_neighborhood_mode, ["off", "observe"], "observe"),
        contextEnvelope: optionalContextEnvelope(input.context_envelope),
        recallControl: input.recall_control && typeof input.recall_control === "object" && !Array.isArray(input.recall_control)
          ? { mode: pick(input.recall_control.mode, RECALL_CONTROL_MODES, "normal"), source: "client" }
          : null,
        familyPolicy: pick(input.family_policy, ["representative", "allow-distinct"], "representative"),
        allowRepeat: Boolean(input.allow_repeat),
        allowRepeatIfStale: Boolean(input.allow_repeat_if_stale),
        vectorMode: input.vector_mode == null ? undefined : input.vector_mode,
      });
    return json(res, 200, { ...recallResponse(recalled, { query, separateBackground: input.separate_background === true }),
      ...(hostStatus ? { host_status: hostStatus } : {}) });
  }
  if (req.method === "POST" && path === "/api/gateway/recall/expand") {
    const input = await readJson(req);
    const audience = pick(input.audience, ["private", "public", "third-party"], "private");
    const memoryId = cleanRequired(input.memory_id, "memory_id", 240);
    const query = cleanRequired(input.query, "query", 4000);
    if (audience !== "private") {
      return json(res, 200, {
        memory_id: memoryId,
        available: false,
        sealed: true,
        reason: "audience-gated",
        detail_level: "sealed",
      });
    }
    const expanded = memoryCore.expand({
      memoryId,
      query,
      context: pick(input.context, ["general", "private", "intimate"], "private"),
      intimacyMode: pick(input.intimacy_mode, INTIMACY_MODES, "off"),
      contextEnvelope: optionalContextEnvelope(input.context_envelope),
      detail: pick(input.detail, ["relevant_chunk", "summary", "full"], "relevant_chunk"),
      maxChars: input.max_chars == null ? 1800 : clampInteger(input.max_chars, 240, 20000),
    });
    if (!expanded) return json(res, 404, { error: "Memory not found" });
    return json(res, 200, {
      ...expanded,
      guidance: expanded.available
        ? "Use this expansion only for the live question that justified opening it. Preserve the stored fact's scope: supporting or associative evidence must not be rewritten as a stronger direct fact."
        : "This memory remains sealed in the current context. Do not infer or reconstruct its hidden body.",
    });
  }
  if (req.method === "POST" && path === "/api/gateway/source-context") {
    const input = await readJson(req);
    const audience = pick(input.audience, ["private", "public", "third-party"], "private");
    const memoryId = cleanRequired(input.memory_id, "memory_id", 240);
    if (audience !== "private") {
      return json(res, 200, { memory_id: memoryId, available: false, reason: "audience-gated", sources: [] });
    }
    const sourceContext = memoryCore.sourceContext({
      memoryId,
      sourceId: cleanOptional(input.source_id, 240),
      query: cleanOptional(input.query, 4000) || "",
      context: pick(input.context, ["general", "private", "intimate"], "private"),
      intimacyMode: pick(input.intimacy_mode, INTIMACY_MODES, "off"),
      maxChars: input.max_chars == null ? 4000 : clampInteger(input.max_chars, 400, 20000),
      view: pick(input.view, ["focused", "full"], "focused"),
    });
    return sourceContext
      ? json(res, 200, sourceContext)
      : json(res, 404, { error: "Memory not found" });
  }
  if (req.method === "POST" && path === "/api/gateway/recall/delivered") {
    const input = await readJson(req);
    try {
      return json(res, 200, memoryCore.acknowledgeDelivery({
        receiptId: input.receipt_id, memoryIds: input.memory_ids,
      }));
    } catch (error) {
      if (error.status === 410) return json(res, 410, { error: error.message });
      if (error instanceof TypeError) throw badRequest(error.message);
      throw error;
    }
  }
  if (req.method === "POST" && path === "/api/sync/pull") {
    const input = await readJson(req);
    try {
      return json(res, 200, continuityCore.pull(input));
    } catch (error) {
      if (error instanceof TypeError) throw badRequest(error.message);
      throw error;
    }
  }
  if (req.method === "POST" && path === "/api/sync/push") {
    const input = await readJson(req);
    try {
      const outcome = continuityCore.push(input);
      return json(res, outcome.duplicate ? 200 : 201, outcome);
    } catch (error) {
      if (error instanceof TypeError) throw badRequest(error.message);
      throw error;
    }
  }
  if (req.method === "GET" && path === "/api/gateway/candidates") {
    const status = pick(
      requestUrl.searchParams.get("status"),
      ["pending", "saved", "drafted", "review", "ignored", "all"],
      "all",
    );
    return json(res, 200, { candidates: memoryCore.candidates({
      status,
      limit: requestUrl.searchParams.get("limit") || 100,
      offset: requestUrl.searchParams.get("offset") || 0,
    }).map(publicCandidate) });
  }
  if (req.method === "POST" && path === "/api/gateway/candidates") {
    const input = await readJson(req);
    try {
      const outcome = await memoryCore.ingestCandidateWithFamily(input);
      return json(res, outcome.duplicate ? 200 : 201, {
        ...outcome,
        candidate: publicCandidate(outcome.candidate),
        memory: outcome.memory ? publicMemory(outcome.memory) : null,
      });
    } catch (error) {
      if (error instanceof TypeError) throw badRequest(error.message);
      throw error;
    }
  }
    return json(res, 404, { error: "Not found" });
  };
}

function deliveryMode(input) {
  const mode = input.delivery_mode ?? "immediate";
  if (!["immediate", "confirmed"].includes(mode)) throw badRequest("Invalid delivery mode");
  return mode;
}

