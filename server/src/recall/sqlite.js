import { listMemories, markRecalled, searchMemoriesFtsShadow, searchMemoriesSituationShadow } from "../database.js";
import { entityCandidateIds } from "../entity/service.js";
import { readLifecycleAuthorities } from "../memory-lifecycle.js";
import { cardArcMemberships, membershipsFor } from "../memory-navigation.js";
import { prepareVectorRecall, prepareAssociativeVectorRecall } from "../vector-retrieval.js";
import { recallMemories as recall, recallMemoriesWithTrace as trace } from "./pipeline.js";
import { progressiveRecall as progressive } from "./progressive.js";
import { readFamilyGroups } from "../family/groups.js";

// One repository per request. Reuse reads across seed/final passes, but discard
// them if this connection or another connection writes during a provider await.
export function createRecallRepository(db) {
  const cache = new Map();
  const changes = db.prepare("SELECT total_changes() AS value");
  const version = db.prepare("PRAGMA data_version");
  let revision;
  const read = (key, load) => {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key);
  };
  return {
    beginRead() {
      const current = `${changes.get().value}:${version.get().data_version}`;
      if (current !== revision) { cache.clear(); revision = current; }
    },
    list: (status) => read(`list:${status}`, () => {
      const groups = read("family-groups", () => readFamilyGroups(db));
      const memories = listMemories(db, { status });
      return groups.size ? memories.map((memory) => groups.has(memory.id)
        ? { ...memory, family_branch_key: groups.get(memory.id) } : memory) : memories;
    }),
    search: (queries) => read(`fts:${JSON.stringify(queries)}`, () => searchMemoriesFtsShadow(db, queries)),
    situation: (input, options) => read(`situation:${JSON.stringify([input, options])}`,
      () => searchMemoriesSituationShadow(db, input, options)),
    entities: (query, policy) => read(`entities:${JSON.stringify([query, policy])}`,
      () => entityCandidateIds(db, query, policy)),
    lifecycle: (memory) => read("lifecycle", () => readLifecycleAuthorities(db))
      .get(memory.family_key || `memory:${memory.id}`),
    arcs(memories, policy) {
      return read(`arcs:${JSON.stringify([memories.map(({ id }) => id), policy])}`, () => {
        const index = cardArcMemberships(db, memories, policy);
        return new Map(memories.map((memory) => [memory.id, membershipsFor(memory, index)]));
      });
    },
    markRecalled: (ids) => markRecalled(db, ids),
  };
}

export function recallMemories(db, input) {
  return recall(createRecallRepository(db), input);
}

export function recallMemoriesWithTrace(db, input) {
  return trace(createRecallRepository(db), input);
}

export function progressiveRecall(db, input) {
  return progressive(createRecallRepository(db), input, {
    primary: (options) => prepareVectorRecall(db, options),
    association: (options) => prepareAssociativeVectorRecall(db, options),
  });
}
