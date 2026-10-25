import { qdrantConfig, deleteQdrantMemories, listQdrantCollections } from "../vector-store.js";

// Durable tombstones outlive canonical rows. Deletion never needs an embedding key.
export async function flushVectorDeletions(db, { fetchImpl = globalThis.fetch } = {}) {
  const rows = db.prepare("SELECT memory_id FROM memory_deletions WHERE vector_pending = 1").all();
  if (!rows.length) return { status: "complete" };
  const store = qdrantConfig();
  try {
    const collections = await listQdrantCollections(store, { fetchImpl });
    const prefix = store.collection.slice(0, -"default".length);
    for (const collection of collections.filter((name) => name.startsWith(prefix))) {
      await deleteQdrantMemories({ ...store, collection }, rows.map((row) => row.memory_id), { fetchImpl });
    }
    const complete = db.prepare("UPDATE memory_deletions SET vector_pending = 0 WHERE memory_id = ?");
    for (const row of rows) complete.run(row.memory_id);
    return { status: "complete" };
  } catch {
    return { status: "pending_retry" };
  }
}
