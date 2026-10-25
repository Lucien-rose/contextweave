import { createHash, randomUUID } from "node:crypto";
import { getMemory, writeMemory } from "../database.js";
import { appendMemoryEvidence } from "../memory-evidence.js";
import { relateCoexistingMemories, relateMemories } from "../memory-relations.js";
import { publicError } from "../lib/error.js";
import { transaction } from "../lib/transaction.js";
import { parseContract, restoreSchema } from "./contract.js";
import { readChange } from "./changes.js";
import { inheritFamilyBranch, memoryBranchKey } from "../family/groups.js";
import { recordFamilyChange } from "../family/history.js";

export function planMemoryRestore(db, memoryId) {
  const memory = getMemory(db, memoryId);
  if (!memory) throw publicError("Memory not found", 404);
  if (!["archived", "superseded"].includes(memory.status)) {
    throw publicError("Only archived or historical memories can be restored", 409);
  }
  const active = activeFamilyMemories(db, memory);
  const strategies = memory.status === "superseded"
    ? ["replace_current"]
    : (active.length ? ["coexist", "replace_current"] : ["activate"]);
  return {
    memory_id: memory.id,
    family_key: memory.family_key,
    source_status: memory.status,
    active_memory_ids: active.map((item) => item.id),
    strategies,
    default_strategy: strategies[0],
  };
}

export function restoreMemory(db, input) {
  const request = parseContract(restoreSchema, input);
  return transaction(db, () => restoreCanonical(db, request));
}

function restoreCanonical(db, request) {
  const source = getMemory(db, request.memory_id);
  if (!source) throw publicError("Memory not found", 404);
  if (source.content_hash !== request.expected_content_hash
      || source.updated_at !== request.expected_updated_at) {
    throw publicError("Memory changed; inspect it again before restoring", 409);
  }
  const plan = planMemoryRestore(db, source.id);
  if (!plan.strategies.includes(request.strategy)) {
    throw publicError("Restore strategy is no longer valid; reload the memory", 409);
  }

  const active = activeFamilyMemories(db, source);
  const before = [source, ...active];
  const now = new Date().toISOString();
  const changeId = `restore:${randomUUID()}`;
  let restored;

  if (request.strategy === "activate") {
    restored = writeMemory(db, { ...source, status: "active", updated_at: now });
  } else if (request.strategy === "coexist") {
    restored = writeMemory(db, { ...source, status: "active", updated_at: now });
  } else {
    for (const current of active) {
      writeMemory(db, { ...current, status: "superseded", updated_at: now });
    }
    const nextVersion = Math.max(source.version, ...active.map((item) => item.version), 0) + 1;
    restored = writeMemory(db, {
      ...source,
      id: `memory:${randomUUID()}`,
      status: "active",
      supersedes_id: active.length === 1 ? active[0].id : null,
      version: nextVersion,
      source_file: "history-restore",
      source_section: `restore:${source.id}`,
      created_at: now,
      updated_at: now,
    });
    appendMemoryEvidence(db, restored.id, source.evidence);
    restored = getMemory(db, restored.id);
    inheritFamilyBranch(db, restored, source);
  }

  const affectedIds = [...new Set([...before.map((item) => item.id), restored.id])];
  const after = affectedIds.map((id) => getMemory(db, id));
  db.prepare(`INSERT INTO memory_changes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(changeId, digest(request), source.family_key, restored.id, source.id,
      "restore", "user_correction", "applied", JSON.stringify(before), JSON.stringify(after), now);

  if (request.strategy === "coexist") {
    for (const current of active) relateCoexistingMemories(db, restored.id, current.id, changeId);
  }
  if (request.strategy === "replace_current") {
    relateMemories(db, {
      sourceId: restored.id,
      targetId: source.id,
      relation: "restored_from",
      changeId,
    });
  }

  recordFamilyChange(db, { changeId, familyKey: source.family_key, operation: "restore",
    before, after: [restored], sources: restored.evidence, at: now });
  return { ...readChange(db, changeId), strategy: request.strategy, restored_from_id: source.id };
}

function activeFamilyMemories(db, memory) {
  return db.prepare(`
    SELECT m.id FROM memories m LEFT JOIN memory_family_groups g
      ON g.memory_id = m.id AND g.family_key = m.family_key
    WHERE m.family_key = ? AND m.status = 'active' AND m.id != ?
      AND COALESCE(g.branch_key, m.family_key) = ?
    ORDER BY m.version DESC, m.updated_at DESC, m.id
  `).all(memory.family_key, memory.id, memoryBranchKey(db, memory)).map((row) => getMemory(db, row.id));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
