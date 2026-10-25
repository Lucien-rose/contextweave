import { createHash } from "node:crypto";
import { getMemory } from "../database.js";
import { transaction } from "../lib/transaction.js";
import { parseContract } from "../lib/contract.js";
import { publicError } from "../lib/error.js";
import { familyReadSchema, familyGroupSchema } from "./contract.js";
import { assignFamilyBranch } from "./groups.js";

export function familySnapshot(db, familyKey) {
  const records = db.prepare(`SELECT * FROM memories WHERE family_key = ? ORDER BY id`).all(familyKey);
  if (!records.length) throw publicError("Lineage not found", 404);
  const groups = db.prepare(`SELECT memory_id, branch_key FROM memory_family_groups
    WHERE family_key = ? ORDER BY memory_id`).all(familyKey);
  const byId = new Map(groups.map((row) => [row.memory_id, row.branch_key]));
  // Include title, metadata and access changes, not recall bookkeeping.
  const stable = records.map(({ recall_count, last_recalled_at, ...row }) => row);
  const fingerprint = createHash("sha256").update(JSON.stringify([stable, groups])).digest("hex");
  return { records, byId, fingerprint };
}

export function readFamily(db, input) {
  const { family_key: familyKey } = parseContract(familyReadSchema, input);
  const { records, byId, fingerprint } = familySnapshot(db, familyKey);
  const branches = new Map();
  for (const row of records) {
    const key = byId.get(row.id) || familyKey;
    if (!branches.has(key)) branches.set(key, []);
    branches.get(key).push(row.id);
  }
  return {
    family_key: familyKey, fingerprint,
    groups: [...branches].map(([branch_key, memory_ids]) => ({ branch_key, memory_ids })),
    members: records.map(({ id, kind, status, content_hash, version, updated_at }) =>
      ({ id, kind, status, content_hash, version, updated_at, branch_key: byId.get(id) || familyKey })),
    judgments: db.prepare(`SELECT id, left_id, right_id, relation, support, model,
      snapshot_fingerprint, created_at FROM memory_family_judgments WHERE family_key = ? ORDER BY created_at DESC, id`)
      .all(familyKey).map(({ snapshot_fingerprint, ...row }) => ({ ...row,
        current: snapshot_fingerprint === fingerprint, applied: false })),
  };
}

export function groupFamily(db, input) {
  const request = parseContract(familyGroupSchema, input);
  return transaction(db, () => {
    const snapshot = familySnapshot(db, request.family_key);
    if (snapshot.fingerprint !== request.expected_fingerprint) throw publicError("Lineage changed; read it again", 409);
    const supplied = request.groups.flat();
    const ids = new Set(snapshot.records.map((row) => row.id));
    if (supplied.length !== ids.size || new Set(supplied).size !== ids.size || supplied.some((id) => !ids.has(id))) {
      throw publicError("Groups must partition every Lineage member exactly once");
    }
    const memories = new Map(snapshot.records.map((row) => [row.id, row]));
    for (const members of request.groups) {
      const key = `branch:${[...members].sort()[0]}`;
      for (const id of members) assignFamilyBranch(db, memories.get(id), key, "manual");
    }
    return { ...readFamily(db, { family_key: request.family_key }), canonical_memories_changed: false };
  });
}

export function familyMemories(db, snapshot) {
  return snapshot.records.map(({ id }) => getMemory(db, id));
}
