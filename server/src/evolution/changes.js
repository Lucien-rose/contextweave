import { createHash, randomUUID } from "node:crypto";
import { getMemory, writeMemory } from "../database.js";
import { appendMemoryEvidence } from "../memory-evidence.js";
import { relateCoexistingMemories, removeRelationsForChange } from "../memory-relations.js";
import { transaction } from "../lib/transaction.js";
import { publicError } from "../lib/error.js";
import { intentSchema, parseContract } from "./contract.js";
import { reviewReason } from "./policy.js";
import { queueReview, resolveReview } from "./reviews.js";
import { inheritFamilyBranch } from "../family/groups.js";
import { recordFamilyChange } from "../family/history.js";

export function applyMemoryIntent(db, input) {
  const intent = parseContract(intentSchema, input);
  return transaction(db, () => applyIntent(db, intent));
}

function applyIntent(db, intent) {
  const hash = digest(intent);
  const existing = db.prepare("SELECT * FROM memory_changes WHERE id = ?").get(intent.change_id);
  if (existing) {
    if (existing.request_hash !== hash) throw publicError("Change ID already used for different input", 409);
    return { ...receipt(existing), replay: true };
  }
  const target = intent.target_memory_id ? getMemory(db, intent.target_memory_id) : null;
  const family = db.prepare("SELECT * FROM memories WHERE family_key = ?").all(intent.family_key);
  const reason = reviewReason(db, intent, target, family);
  if (reason) {
    const review = queueReview(db, intent, reason);
    return { status: "review_required", reason, review_id: review.review_id,
      family_key: intent.family_key, canonical_memories_changed: false };
  }
  const before = target ? [target] : [];
  const now = new Date().toISOString();
  let memory;
  if (intent.operation === "reinforce") {
    memory = writeMemory(db, { ...target, updated_at: now });
  } else {
    const replacing = ["supersede", "correct"].includes(intent.operation);
    if (replacing) writeMemory(db, { ...target, status: "superseded", updated_at: now });
    memory = writeMemory(db, {
      ...(target || {}),
      ...(!target && intent.lifecycle_class === "protected" ? {
        sensitivity: "intimate", scope: "private_relationship", mentionability: "explicit-only",
        activation_policy: "explicit_trigger", egress_policy: "local_only",
      } : {}),
      ...(intent.attributes || {}),
      recall_summary: intent.attributes?.recall_summary ?? intent.attributes?.safe_projection
        ?? (target?.content === intent.content ? target.recall_summary : null),
      public_projection: intent.attributes?.public_projection
        ?? (target?.content === intent.content ? target.public_projection : null),
      id: `memory:${randomUUID()}`,
      kind: intent.memory_kind || target?.kind
        || { belief: "preference", episode: "episode", protected: "anchor" }[intent.lifecycle_class],
      title: intent.title, content: intent.content, family_key: intent.family_key,
      status: "active", supersedes_id: replacing ? target.id : null,
      version: target ? target.version + 1 : 1,
      source_file: "host-intent", source_section: `evolution:${intent.operation}`,
      source_hash: hash, created_at: now, updated_at: now,
    });
  }
  const knownSources = new Set((memory.evidence || []).map((ref) => JSON.stringify([ref.source_type, ref.source_id])));
  appendMemoryEvidence(db, memory.id, intent.source_refs.filter((ref) => !knownSources.has(JSON.stringify([ref.source_type, ref.source_id]))));
  const ids = [...new Set([...before.map((m) => m.id), memory.id])];
  const after = ids.map((id) => getMemory(db, id));
  db.prepare(`INSERT INTO memory_changes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(intent.change_id, hash, intent.family_key, memory.id, target?.id || null,
      intent.operation, intent.authority, "applied", JSON.stringify(before), JSON.stringify(after), now);
  if (intent.operation === "coexist") {
    relateCoexistingMemories(db, target.id, memory.id, intent.change_id);
  }
  inheritFamilyBranch(db, memory, target, {
    distinct: ["append_episode", "coexist"].includes(intent.operation),
  });
  recordFamilyChange(db, { changeId: intent.change_id, familyKey: intent.family_key,
    operation: intent.operation, before, after: [getMemory(db, memory.id)],
    explanation: intent.change_explanation, sources: getMemory(db, memory.id).evidence, at: now });
  resolveReview(db, intent.family_key, new Date(now));
  return readChange(db, intent.change_id);
}

export function readChange(db, id, { detail = false } = {}) {
  const row = db.prepare("SELECT * FROM memory_changes WHERE id = ?").get(id);
  if (!row) return null;
  return { ...receipt(row), ...(detail ? {
    before: JSON.parse(row.before_json || "[]"), after: JSON.parse(row.after_json || "[]"),
  } : {}) };
}

export function listChanges(db, familyKey) {
  const rows = familyKey
    ? db.prepare("SELECT * FROM memory_changes WHERE family_key = ? ORDER BY rowid DESC LIMIT 100").all(familyKey)
    : db.prepare("SELECT * FROM memory_changes ORDER BY rowid DESC LIMIT 100").all();
  return rows.map(receipt);
}

export function undoChange(db, { change_id, confirmation }) {
  if (confirmation !== true) throw publicError("Explicit undo request required");
  return transaction(db, () => {
    const change = readChange(db, change_id, { detail: true });
    if (!change) throw publicError("Change not found", 404);
    if (change.status === "undone") return change;
    if (change.status !== "applied") throw publicError("Deleted changes cannot be undone", 409);
    const later = db.prepare(`SELECT id FROM memory_changes WHERE family_key = ? AND status = 'applied'
      AND rowid > (SELECT rowid FROM memory_changes WHERE id = ?) LIMIT 1`).get(change.family_key, change_id);
    if (later || change.after.some((m) => digest(comparable(getMemory(db, m.id))) !== digest(comparable(m)))) {
      throw publicError("Memory changed since this receipt; review the latest version before undo", 409);
    }
    const now = new Date().toISOString();
    removeRelationsForChange(db, change_id);
    for (const current of change.after) {
      const previous = change.before.find((m) => m.id === current.id);
      writeMemory(db, { ...(previous || current), status: previous?.status || "archived", updated_at: now });
      if (previous) {
        db.prepare("DELETE FROM memory_evidence WHERE memory_id = ?").run(previous.id);
        appendMemoryEvidence(db, previous.id, previous.evidence);
      }
    }
    db.prepare("UPDATE memory_changes SET status = 'undone' WHERE id = ?").run(change_id);
    db.prepare("UPDATE family_change_receipts SET status='undone' WHERE change_id=?").run(change_id);
    const id = `undo:${randomUUID()}`;
    db.prepare("INSERT INTO memory_changes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, digest({ change_id }), change.family_key, change.memory_id, change.target_id,
        "undo", "user_correction", "recorded", null, null, now);
    recordFamilyChange(db, { changeId: id, familyKey: change.family_key, operation: "undo",
      before: change.after, after: change.after.map(item => getMemory(db, item.id)), at: now });
    return { ...readChange(db, change_id), undo_change_id: id };
  });
}

function comparable(memory) {
  if (!memory) return null;
  const { recall_count, last_recalled_at, timeline, ...stable } = memory;
  return stable;
}

function receipt(row) {
  const { id, family_key, memory_id, target_id, operation, authority, status, created_at } = row;
  return { change_id: id, family_key, memory_id, target_id, operation, authority, status, created_at,
    notification: operation === "reinforce" ? "silent" : "brief" };
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
