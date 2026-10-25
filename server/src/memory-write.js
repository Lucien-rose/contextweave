import { getMemory } from "./database.js";
import { applyMemoryIntent } from "./evolution/changes.js";
import { judgeFamily } from "./family/jev.js";
import { classifyStarfields } from "./starfield/classify.js";

export async function maintainMemoryWrite(db, memoryId, familyOptions) {
  const memory = getMemory(db, memoryId);
  if (!memory || memory.status !== "active") return { family_judgment: null, starfield: null };
  const [family_judgment, starfield] = await Promise.all([
    judgeFamily(db, { family_key: memory.family_key, memory_id: memory.id }, familyOptions),
    classifyStarfields(db, { memoryId: memory.id }),
  ]);
  return { family_judgment, starfield };
}

export async function applyIntentWithMaintenance(db, input, familyOptions) {
  const receipt = applyMemoryIntent(db, input);
  if (receipt.status !== "applied" || receipt.replay) return receipt;
  return { ...receipt, ...await maintainMemoryWrite(db, receipt.memory_id, familyOptions) };
}
