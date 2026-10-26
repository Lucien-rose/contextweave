import { createHash } from "node:crypto";
import { getMemory, writeMemory, audit } from "./database.js";
import { appendMemoryEvidence } from "./memory-evidence.js";
import { inheritFamilyBranch } from "./family/groups.js";
import { recordFamilyChange } from "./family/history.js";
import { contentHash } from "./memory-record.js";
import { SEMANTIC_MEMORY_KINDS } from "./memory-kind.js";
import { transaction } from "./lib/transaction.js";

const KINDS = new Set(SEMANTIC_MEMORY_KINDS);
const SENSITIVITIES = new Set(["personal", "private", "sensitive", "intimate"]);
const MENTIONABILITY = new Set(["natural", "contextual", "explicit-only"]);
const LOAD_POLICIES = new Set(["contextual", "deep-rotate", "manifest-always", "explicit-only"]);
const SCOPES = new Set(["private_general", "private_relationship"]);
const ACTIVATION = new Set(["explicit_trigger", "relationship_contextual", "scene_only"]);
const LAYERS = new Set(["core", "context", "archive"]);
const STATUSES = new Set(["active", "archived"]);
const MAX_MEMORIES = 10000;

function plain(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function string(value, field, max, required = false) {
  if (value == null || value === "") {
    if (required) throw new TypeError(`${field} is required`);
    return null;
  }
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new TypeError(`${field} must be nonempty text of at most ${max} characters`);
  }
  return value.trim();
}

function choice(value, allowed, field, fallback) {
  if (value == null) return fallback;
  if (!allowed.has(value)) throw new TypeError(`Unsupported ${field}: ${String(value)}`);
  return value;
}

function array(value, field, count, max) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > count) throw new TypeError(`${field} must be an array of at most ${count} strings`);
  return [...new Set(value.map(item => string(item, field, max, true)))];
}

function date(value, field) {
  if (value == null || value === "") return null;
  const text = string(value, field, 40, true);
  if (field === "event_date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) throw new TypeError("Invalid event_date");
  } else if (Number.isNaN(Date.parse(text))) throw new TypeError(`Invalid ${field}`);
  return text;
}

function sourceRefs(input) {
  const sources = input.source_refs ?? input.evidence ?? [];
  if (!Array.isArray(sources) || sources.length > 30) throw new TypeError("source_refs/evidence must be an array of at most 30 items");
  const seen = new Set();
  return sources.map(source => {
    if (!plain(source)) throw new TypeError("Source reference must be an object");
    const source_type = string(source.source_type, "source_type", 80, true);
    const source_id = string(source.source_id, "source_id", 240, true);
    const key = JSON.stringify([source_type, source_id]);
    if (seen.has(key)) throw new TypeError("Duplicate source reference");
    seen.add(key);
    const metadata = source.metadata ?? {};
    if (!plain(metadata) || JSON.stringify(metadata).length > 4000) throw new TypeError("Invalid source metadata");
    return {
      source_type, source_id, excerpt: string(source.excerpt, "excerpt", 5000),
      occurred_at: date(source.occurred_at, "occurred_at"),
      written_at: date(source.written_at, "written_at"),
      metadata,
      // Foreign material_id values from other databases are deliberately not reused.
    };
  });
}

function normalize(input) {
  const raw = typeof input === "string" ? { content: input } : input;
  if (!plain(raw)) throw new TypeError("Memory must be an object or string");
  const content = string(raw.content, "content", 50000, true);
  const title = string(raw.title || content.slice(0, 80), "title", 160, true);
  const kind = choice(raw.kind, KINDS, "kind", "memory");
  const event_date = date(raw.event_date, "event_date");
  const refs = sourceRefs(raw);
  const fingerprint = JSON.stringify({ title, content, kind, event_date });
  const id = raw.id == null ? `import:${createHash("sha256").update(fingerprint).digest("hex").slice(0, 32)}`
    : string(raw.id, "id", 240, true);
  const sensitivity = choice(raw.sensitivity, SENSITIVITIES, "sensitivity", "private");
  const importance = raw.importance == null ? 50 : raw.importance;
  if (!Number.isInteger(importance) || importance < 0 || importance > 100) throw new TypeError("importance must be an integer 0–100");
  if (raw.supersedes_id) throw new TypeError("supersedes_id requires full database restore, not memory import");
  const status = choice(raw.status, STATUSES, "status", "active");
  const layer = choice(raw.layer, LAYERS, "layer", importance >= 85 ? "core" : importance >= 60 ? "context" : "archive");
  const standing_opt_in = raw.standing_opt_in == null ? false : raw.standing_opt_in;
  if (typeof standing_opt_in !== "boolean") throw new TypeError("standing_opt_in must be boolean");
  const memory = {
    id, title, content, kind, event_date, importance, layer, status, sensitivity,
    mentionability: choice(raw.mentionability, MENTIONABILITY, "mentionability", "contextual"),
    tags: array(raw.tags, "tags", 30, 80),
    triggers: array(raw.triggers, "triggers", 30, 120),
    ambient_triggers: array(raw.ambient_triggers, "ambient_triggers", 30, 120),
    family_key: string(raw.family_key, "family_key", 160) || `memory:${id}`,
    safe_projection: string(raw.safe_projection, "safe_projection", 5000),
    recall_summary: string(raw.recall_summary, "recall_summary", 5000),
    public_projection: string(raw.public_projection, "public_projection", 5000),
    load_policy: choice(raw.load_policy, LOAD_POLICIES, "load_policy", "contextual"),
    standing_opt_in,
    scope: choice(raw.scope, SCOPES, "scope", sensitivity === "intimate" ? "private_relationship" : "private_general"),
    activation_policy: choice(raw.activation_policy, ACTIVATION, "activation_policy",
      kind === "intimate-agreement" && standing_opt_in ? "relationship_contextual" : "explicit_trigger"),
    egress_policy: "local_only",
    version: 1,
    source_file: "memory-package",
    source_section: "import:v1",
  };
  if (raw.version != null && raw.version !== 1) throw new TypeError("Versioned history requires full database restore");
  if (raw.created_at != null) memory.created_at = date(raw.created_at, "created_at");
  if (raw.updated_at != null) memory.updated_at = date(raw.updated_at, "updated_at");
  return { memory, refs, fingerprint };
}

export function parseMemoryPackage(packageJson) {
  if (!plain(packageJson) && !Array.isArray(packageJson)) throw new TypeError("Expected a JSON object or array");
  if (plain(packageJson) && packageJson.format != null && packageJson.format !== "contextweave-memory-package") {
    throw new TypeError("Unsupported package format");
  }
  if (plain(packageJson) && packageJson.version != null && packageJson.version !== 1) {
    throw new TypeError("Unsupported package version");
  }
  const items = Array.isArray(packageJson) ? packageJson : packageJson.memories;
  if (!Array.isArray(items) || items.length > MAX_MEMORIES) {
    throw new TypeError(`Package must contain a memories array (maximum ${MAX_MEMORIES})`);
  }
  return { items, ownerExport: Boolean(packageJson.memory_state || packageJson.continuity) };
}

export function previewMemoryPackage(db, packageJson) {
  const { items, ownerExport } = parseMemoryPackage(packageJson);
  const rows = [];
  const issues = [];
  const counts = { total: items.length, new: 0, duplicates: 0, conflicts: 0, invalid: 0 };
  const seenIds = new Map();
  const seenContent = new Set();
  const byHash = db.prepare("SELECT id, title, content, kind, event_date FROM memories WHERE content_hash = ?");
  const deleted = db.prepare("SELECT 1 FROM memory_deletions WHERE memory_id = ?");
  for (const [index, input] of items.entries()) {
    try {
      const row = normalize(input);
      const { memory, fingerprint } = row;
      const existing = getMemory(db, memory.id);
      let outcome = "new", reason = null;
      if (deleted.get(memory.id)) { outcome = "conflicts"; reason = "deleted ID cannot be reused"; }
      else if (existing) {
        if (existing.title === memory.title && existing.content === memory.content
          && existing.kind === memory.kind && existing.event_date === memory.event_date
          && existing.status === memory.status) outcome = "duplicates";
        else { outcome = "conflicts"; reason = "ID already belongs to a different memory"; }
      } else if (seenIds.has(memory.id)) {
        if (seenIds.get(memory.id) === fingerprint) outcome = "duplicates";
        else { outcome = "conflicts"; reason = "ID collision within package"; }
      } else if (seenContent.has(fingerprint)
        || byHash.all(contentHash(memory.content)).some(other =>
          other.title === memory.title && other.content === memory.content
          && other.kind === memory.kind && other.event_date === memory.event_date)) {
        outcome = "duplicates";
      }
      counts[outcome] += 1;
      if (outcome === "new") rows.push(row);
      if (reason && issues.length < 100) issues.push({ index, id: memory.id, type: outcome, reason });
      seenIds.set(memory.id, fingerprint);
      seenContent.add(fingerprint);
    } catch (error) {
      counts.invalid += 1;
      if (issues.length < 100) issues.push({ index, type: "invalid", reason: error.message });
    }
  }
  return {
    mode: "dry-run", ...counts, issues, rows,
    warnings: ownerExport ? ["Owner export detected: this imports supported memory records and evidence excerpts only; it does not restore Lineage receipts, portraits, full source materials, or continuity state. Use database snapshot restore for a full restore."] : [],
  };
}

export function applyMemoryPackage(db, packageJson, { skipProblems = false } = {}) {
  return transaction(db, () => {
    const preview = previewMemoryPackage(db, packageJson);
    if (!skipProblems && (preview.conflicts || preview.invalid)) {
      throw new TypeError(`Import blocked: ${preview.conflicts} conflicts, ${preview.invalid} invalid. Review dry-run or explicitly use --skip-problems.`);
    }
    for (const { memory, refs } of preview.rows) {
      writeMemory(db, memory);
      appendMemoryEvidence(db, memory.id, refs);
      const saved = getMemory(db, memory.id);
      inheritFamilyBranch(db, saved, null, { distinct: false });
      audit(db, saved.id, "memory-package-import", saved);
      recordFamilyChange(db, { changeId: `import:${saved.id}`, familyKey: saved.family_key,
        operation: "import", after: [saved], sources: saved.evidence });
    }
    const { rows, ...summary } = preview;
    return { ...summary, mode: "apply", imported: rows.length, skipped: preview.duplicates + preview.conflicts + preview.invalid };
  });
}
