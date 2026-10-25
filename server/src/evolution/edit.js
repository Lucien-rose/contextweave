import { randomUUID } from "node:crypto";
import { getMemory, writeMemory } from "../database.js";
import { appendMemoryEvidence } from "../memory-evidence.js";
import { publicError } from "../lib/error.js";
import { transaction } from "../lib/transaction.js";
import { classifyLifecycleMemory } from "../lifecycle-classification.js";
import { readChange } from "./changes.js";
import { inheritFamilyBranch } from "../family/groups.js";
import { recordFamilyChange } from "../family/history.js";

// Explicit editor saves have user authority. They do not reuse delegated policy.
export function editMemory(db, id, fields, { expected_content_hash, expected_updated_at }) {
  return transaction(db, () => {
    const before = getMemory(db, id);
    if (!before || before.status !== "active") throw publicError("Only current memories can be revised", 409);
    if (before.content_hash !== expected_content_hash || before.updated_at !== expected_updated_at) {
      throw publicError("Memory changed while editing; reload before saving", 409);
    }
    if (classifyLifecycleMemory(before) === "episode") {
      throw publicError("Episodes are immutable; append a correction event instead", 409);
    }
    const now = new Date().toISOString();
    const changeId = `edit:${randomUUID()}`;
    writeMemory(db, { ...before, status: "superseded", updated_at: now });
    const { requested_kind, ...editable } = fields;
    const after = writeMemory(db, {
      ...before, ...editable, id: `memory:${randomUUID()}`, kind: before.kind,
      family_key: before.family_key, supersedes_id: id, status: "active",
      version: before.version + 1, created_at: now, updated_at: now,
    });
    appendMemoryEvidence(db, after.id, [{ source_type: "admin-editor", source_id: changeId }]);
    inheritFamilyBranch(db, after, before);
    db.prepare("INSERT INTO memory_changes VALUES (?, ?, ?, ?, ?, 'correct', 'user_correction', 'applied', ?, ?, ?)")
      .run(changeId, changeId, before.family_key, after.id, id, JSON.stringify([before]),
        JSON.stringify([getMemory(db, id), getMemory(db, after.id)]), now);
    recordFamilyChange(db, { changeId, familyKey: before.family_key, operation: "correct",
      before: [before], after: [after], at: now });
    return { memory: getMemory(db, after.id), change: readChange(db, changeId) };
  });
}
