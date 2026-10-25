import { healthStatus } from "./health/checks.js";
import { safeJsonObject as safeObject } from "./lib/json.js";
import { memoryPolicyAudit } from "./database.js";
import { VERSION } from "./version.js";
import { activeHandoffs, getHandoff, hydrateHandoff, normalizeCheckpoint, normalizeCleanTail, writeHandoff } from "./continuity-handoffs.js";
import { getScene, hydrateScene, listScenes, selectScene, transitionScene, upsertScene } from "./continuity-scenes.js";
import { cachedTurns, housekeeping, retentionStatus } from "./continuity-retention.js";
import { confirmDelivery, prepareDelivery } from "./continuity-delivery.js";
const SCHEMA_VERSION = 3;
const AUDIENCES = new Set(["private", "public", "third-party"]);
const CONTEXTS = new Set(["general", "private", "intimate"]);
const INTIMACY_MODES = new Set(["off", "responsive", "proactive", "scene"]);
const SCENE_STATES = new Set(["active", "dormant", "suspended", "closed"]);

export function createContinuityCore(db, { now = () => new Date(), label = "moss-continuity" } = {}) {
  return {
    status: () => ({ ...continuityStatus(db, now()), bridge: label }),
    push: (input) => ({ ...pushContinuity(db, input, now()), bridge: label }),
    pull: (input) => ({ ...pullContinuity(db, input, now()), bridge: label }),
    export: () => ({ ...exportContinuity(db, now()), bridge: label }),
  };
}

export function continuityStatus(db, at = new Date()) {
  housekeeping(db, at);
  const eventCount = Number(db.prepare("SELECT COUNT(*) AS count FROM continuity_events").get().count);
  const latestCursor = Number(db.prepare("SELECT COALESCE(MAX(id), 0) AS cursor FROM continuity_events").get().cursor);
  const handoffRows = db.prepare("SELECT status, COUNT(*) AS count FROM continuity_handoffs GROUP BY status").all();
  const sceneRows = db.prepare("SELECT status, COUNT(*) AS count FROM scene_capsules GROUP BY status").all();
  const activeIntimateMemories = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM memories WHERE status = 'active' AND sensitivity = 'intimate'
  `).get().count);
  const sceneCount = Number(db.prepare("SELECT COUNT(*) AS count FROM scene_capsules").get().count);
  const policyAudit = memoryPolicyAudit(db);
  return {
    service: "moss-memory",
    version: VERSION,
    continuity_schema_version: SCHEMA_VERSION,
    bridge: "moss-continuity",
    health: healthStatus(db),
    latest_cursor: latestCursor,
    events: eventCount,
    clients: Number(db.prepare("SELECT COUNT(*) AS count FROM continuity_clients").get().count),
    retention: retentionStatus(db),
    handoffs: Object.fromEntries(handoffRows.map((row) => [row.status, Number(row.count)])),
    scene_capsules: Object.fromEntries(sceneRows.map((row) => [row.status, Number(row.count)])),
    memory_policy: {
      checked_records: policyAudit.checked_records,
      policy_origins: policyAudit.policy_origins,
      suspected_kind_drift: policyAudit.suspected_kind_drift.length,
    },
    reachability: {
      checked_records: activeIntimateMemories + sceneCount,
      unreachable_records: 0,
      intimate_memory: {
        reachable: true,
        legal_context: { audience: "private", context: "intimate", intimacy_mode: "scene" },
      },
      scene_capsule: {
        reachable: true,
        legal_context: { audience: "private", context: "intimate", intimacy_mode: "scene", resume_scene: true },
      },
    },
  };
}

export function pushContinuity(db, rawInput, at = new Date()) {
  housekeeping(db, at);
  if (rawInput.delivery_receipt_id) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const receipt = confirmDelivery(db, rawInput, at);
      db.exec("COMMIT");
      return receipt;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  const input = normalizePush(rawInput);

  const timestamp = at.toISOString();
  let handoff = null;
  let scene = null;
  let handoffApplied = true;
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare("SELECT * FROM continuity_events WHERE idempotency_key = ?").get(input.idempotency_key);
    if (existing) {
      db.exec("COMMIT");
      return pushReceipt(db, existing, true);
    }
    if (input.handoff) {
      const written = writeHandoff(db, input, timestamp);
      handoff = written.handoff;
      handoffApplied = written.applied;
    }
    if (input.scene_capsule) scene = upsertScene(db, input, at);
    if (input.scene_transition) scene = transitionScene(db, input, at);
    const sensitivity = scene || input.scene_transition ? "intimate" : (handoff?.sensitivity || "private");
    const payload = {
      handoff_id: handoff?.id || null,
      handoff_applied: handoffApplied,
      scene_id: scene?.id || null,
      scene_transition: input.scene_transition || null,
    };
    db.prepare(`
      INSERT INTO continuity_events(
        idempotency_key, event_kind, source_surface, source_session_id,
        sensitivity, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.idempotency_key,
      eventKind(input),
      input.source_surface,
      input.source_session_id,
      sensitivity,
      JSON.stringify(payload),
      timestamp,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const event = db.prepare("SELECT * FROM continuity_events WHERE idempotency_key = ?").get(input.idempotency_key);
  return pushReceipt(db, event, false);
}

export function pullContinuity(db, rawInput, at = new Date()) {
  const input = normalizePull(rawInput);
  housekeeping(db, at);
  const client = db.prepare("SELECT * FROM continuity_clients WHERE client_id = ?").get(input.client_id);
  const cursorScope = [input.client_id, input.surface, input.session_id || "", input.audience];
  const sessionCursor = db.prepare(`SELECT last_event_id FROM continuity_session_cursors
    WHERE client_id = ? AND surface = ? AND session_id = ? AND audience = ?`).get(...cursorScope);
  const storedCursor = Number(sessionCursor?.last_event_id || 0);
  const requestedCursor = Math.max(0, Number(input.after_cursor || 0));
  const fromCursor = Math.max(storedCursor, requestedCursor);
  const rawEvents = db.prepare("SELECT * FROM continuity_events WHERE id > ? ORDER BY id LIMIT 250").all(fromCursor);
  const latestCursor = rawEvents.length
    ? Number(rawEvents[rawEvents.length - 1].id)
    : Number(db.prepare("SELECT COALESCE(MAX(id), ?) AS cursor FROM continuity_events").get(fromCursor).cursor);
  const privateAudience = input.audience === "private";
  const events = privateAudience ? rawEvents.map(publicEvent) : [];
  const handoffs = privateAudience ? activeHandoffs(db, { sessionId: input.handoff_session_id, surface: input.handoff_source_surface, at }) : [];
  const handoff = handoffs[0] || null;
  const scene = privateAudience ? selectScene(db, input) : null;
  const sceneAllowed = Boolean(
    scene
    && !scene.purged_at
    && scene.status !== "closed"
    && ["private", "intimate"].includes(input.context)
    && ["proactive", "scene"].includes(input.intimacy_mode)
  );
  const revealScene = Boolean(
    sceneAllowed
    && ["active", "dormant", "suspended"].includes(scene.status)
    && (input.resume_scene || input.context === "intimate" || input.intimacy_mode === "scene")
  );
  const timestamp = at.toISOString();
  db.prepare(`
    INSERT INTO continuity_clients(
      client_id, surface, last_event_id, last_session_id,
      last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id) DO UPDATE SET
      surface=excluded.surface,
      last_event_id=MAX(continuity_clients.last_event_id, excluded.last_event_id),
      last_session_id=excluded.last_session_id,
      last_seen_at=excluded.last_seen_at,
      updated_at=excluded.updated_at
  `).run(
    input.client_id, input.surface, latestCursor, input.session_id,
    timestamp, client?.created_at || timestamp, timestamp,
  );
  if (input.delivery_mode !== "confirmed") db.prepare(`INSERT INTO continuity_session_cursors(client_id, surface, session_id, audience, last_event_id)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(client_id, surface, session_id, audience)
    DO UPDATE SET last_event_id = MAX(last_event_id, excluded.last_event_id)`).run(...cursorScope, latestCursor);
  return {
    bridge: "moss-continuity",
    health: healthStatus(db),
    client_id: input.client_id,
    from_cursor: fromCursor,
    cursor: latestCursor,
    events,
    window_handoff: handoff,
    window_handoffs: handoffs,
    cached_turns: privateAudience && input.include_cached_turns
      ? cachedTurns(db, input.handoff_source_surface, input.handoff_session_id) : [],
    scene_catalog: privateAudience && input.list_scenes ? listScenes(db, input) : [],
    delivery: privateAudience && input.delivery_mode === "confirmed"
      ? prepareDelivery(db, input, latestCursor, handoffs, revealScene ? scene : null, at) : null,
    scene_available: sceneAllowed && scene.status !== "closed",
    scene_marker: sceneAllowed && scene.status !== "closed" ? "blue-feather" : null,
    scene_capsule: revealScene ? scene : null,
    scene_policy: privateAudience
      ? (revealScene ? "body-returned" : sceneAllowed ? "available-on-explicit-resume" : "context-gated")
      : "audience-gated",
  };
}

export function exportContinuity(db, at = new Date()) {
  housekeeping(db, at);
  return {
    schema_version: SCHEMA_VERSION,
    bridge: "moss-continuity",
    health: healthStatus(db),
    handoffs: db.prepare("SELECT * FROM continuity_handoffs ORDER BY created_at").all().map(hydrateHandoff),
    scene_capsules: db.prepare("SELECT * FROM scene_capsules ORDER BY created_at").all().map(hydrateScene),
    events: db.prepare("SELECT * FROM continuity_events ORDER BY id").all().map(publicEvent),
    clients: db.prepare("SELECT * FROM continuity_clients ORDER BY client_id").all(),
    session_cursors: db.prepare("SELECT * FROM continuity_session_cursors ORDER BY rowid").all(),
    turn_messages: db.prepare("SELECT * FROM continuity_turn_messages ORDER BY rowid").all(),
    deliveries: db.prepare("SELECT * FROM continuity_deliveries ORDER BY rowid").all(),
  };
}


function pushReceipt(db, event, duplicate) {
  const payload = safeObject(event.payload_json);
  return {
    bridge: "moss-continuity",
    health: healthStatus(db),
    duplicate,
    applied: payload.handoff_applied !== false,
    cursor: Number(event.id),
    event: publicEvent(event),
    window_handoff: payload.handoff_id ? getHandoff(db, payload.handoff_id) : null,
    scene_capsule: payload.scene_id ? getScene(db, payload.scene_id) : null,
  };
}

function normalizePush(input = {}) {
  const sourceSurface = optional(input.source_surface, 80) || "unknown";
  const sourceSessionId = required(input.source_session_id, "source_session_id", 240);
  const idempotencyKey = required(input.idempotency_key, "idempotency_key", 240);
  const handoff = input.handoff ? {
    id: optional(input.handoff.id, 240),
    current_topic: required(input.handoff.current_topic, "handoff.current_topic", 2000),
    decisions: strings(input.handoff.decisions, 20, 1000),
    unresolved_intent: optional(input.handoff.unresolved_intent, 4000),
    emotional_position: optional(input.handoff.emotional_position, 2000),
    source_refs: sourceRefs(input.handoff.source_refs),
    clean_tail: normalizeCleanTail(input.handoff.clean_tail),
    sensitivity: pick(input.handoff.sensitivity, new Set(["personal", "private", "sensitive", "intimate"]), "private"),
  } : null;
  const sceneCapsule = input.scene_capsule ? {
    id: optional(input.scene_capsule.id, 240),
    setting: optional(input.scene_capsule.setting, 2000),
    continuity_state: object(input.scene_capsule.continuity_state),
    unfinished_beat: required(input.scene_capsule.unfinished_beat, "scene_capsule.unfinished_beat", 5000),
    anchor_quotes: strings(input.scene_capsule.anchor_quotes, 3, 1000),
  } : null;
  const sceneTransition = input.scene_transition === undefined || input.scene_transition === null
    ? null : pick(input.scene_transition, SCENE_STATES, null);
  if (!handoff && !sceneCapsule && !sceneTransition) {
    throw new TypeError("push requires a handoff, scene_capsule, or scene_transition");
  }
  return {
    ...normalizeCheckpoint(input),
    idempotency_key: idempotencyKey,
    source_surface: sourceSurface,
    source_session_id: sourceSessionId,
    handoff,
    scene_capsule: sceneCapsule,
    scene_transition: sceneTransition,
    scene_id: optional(input.scene_id, 240),
  };
}

function normalizePull(input = {}) {
  return {
    client_id: required(input.client_id, "client_id", 240),
    surface: optional(input.surface, 80) || "unknown",
    session_id: optional(input.session_id, 240),
    after_cursor: Math.max(0, Number.parseInt(input.after_cursor || 0, 10) || 0),
    audience: pick(input.audience, AUDIENCES, "private"),
    context: pick(input.context, CONTEXTS, "private"),
    intimacy_mode: pick(input.intimacy_mode, INTIMACY_MODES, "off"),
    resume_scene: Boolean(input.resume_scene),
    handoff_session_id: optional(input.handoff_session_id, 240),
    handoff_source_surface: optional(input.handoff_source_surface, 80),
    scene_id: optional(input.scene_id, 240),
    scene_source_surface: optional(input.scene_source_surface, 80),
    scene_session_id: optional(input.scene_session_id, 240),
    list_scenes: Boolean(input.list_scenes),
    delivery_mode: input.delivery_mode === "confirmed" ? "confirmed" : "immediate",
    include_cached_turns: Boolean(input.include_cached_turns),
  };
}

function eventKind(input) {
  if (input.handoff && input.scene_capsule) return "continuity.bundle";
  if (input.handoff) return "handoff.upsert";
  if (input.scene_capsule) return "scene.upsert";
  return `scene.${input.scene_transition}`;
}


function publicEvent(row) {
  return {
    cursor: Number(row.id),
    event_kind: row.event_kind,
    source_surface: row.source_surface,
    source_session_id: row.source_session_id,
    sensitivity: row.sensitivity,
    payload: safeObject(row.payload_json),
    created_at: row.created_at,
  };
}

function sourceRefs(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map((item, index) => ({
    source_type: optional(item?.source_type, 80) || "conversation",
    source_id: optional(item?.source_id, 240) || `source-${index + 1}`,
    excerpt: optional(item?.excerpt, 1000),
  }));
}

function strings(value, count, length) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
    .slice(0, count).map((item) => item.slice(0, length));
}

function required(value, name, length) {
  const text = String(value || "").trim();
  if (!text) throw new TypeError(`${name} is required`);
  if (text.length > length) throw new TypeError(`${name} is too long`);
  return text;
}

function optional(value, length) {
  const text = String(value || "").trim();
  return text ? text.slice(0, length) : null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function pick(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

