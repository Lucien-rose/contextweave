// Synthetic example of the Core repository contract. Production uses SQLite.
export function createDemoRepository(memories) {
  return {
    beginRead() {},
    list: (status) => memories.filter((memory) => memory.status === status),
    search: () => ({ items: [], query_count: 0, term_count: 0, reason: "demo-no-fts" }),
    situation: () => ({ items: [], query_count: 0, concept_count: 0, reason: "demo-no-situation-index" }),
    entities: () => new Map(),
    lifecycle: () => null,
    arcs: () => new Map(),
    markRecalled() {},
  };
}
