import { createHash, randomUUID } from "node:crypto";
import { clampInteger } from "./lib/number.js";
import { getMemory } from "./database.js";
import { memoryVectorDocuments } from "./vector-projection.js";
import { vectorEnvValue } from "./vector-settings.js";
import { deleteQdrantMemories, qdrantPointId, upsertQdrantPoints } from "./vector-store.js";
import { clearVectorJob, listVectorJobs, markVectorIndexed } from "./vector-state.js";

const DEFAULT_EMBED_BATCH = 64;

export async function syncPendingVectors(db, options) {
  const { identity } = options;
  const token = randomUUID();
  const renew = () => {
    const lease = db.prepare("SELECT token,until_at FROM vector_sync_leases WHERE identity=?").get(identity);
    if (lease?.token !== token || lease.until_at <= new Date().toISOString()) {
      throw Object.assign(new Error("Vector sync lease expired"), { code: "sync-lease-expired" });
    }
    db.prepare("UPDATE vector_sync_leases SET until_at=? WHERE identity=? AND token=?")
      .run(new Date(Date.now()+300000).toISOString(), identity, token);
  };
  const acquired = db.prepare(`INSERT INTO vector_sync_leases VALUES (?,?,?) ON CONFLICT(identity) DO UPDATE
    SET token=excluded.token,until_at=excluded.until_at WHERE until_at<=?`).run(identity,token,
    new Date(Date.now()+300000).toISOString(),new Date().toISOString()).changes;
  if (!acquired) return { processed: 0, indexed: 0, busy: true };
  try { return await syncBatch(db, { ...options, renew }); }
  finally { db.prepare("DELETE FROM vector_sync_leases WHERE identity=? AND token=?").run(identity, token); }
}

async function syncBatch(db, {
  provider, identity, store, embedder, fetchImpl, limit, memoryIds = null, renew,
}) {
  const jobs = listVectorJobs(db, limit, memoryIds, identity);
  if (!jobs.length) return { processed: 0, indexed: 0 };
  const active = [];
  const removed = [];
  for (const job of jobs) {
    const memory = getMemory(db, job.memory_id);
    if (!memory || !["active", "superseded"].includes(memory.status)) removed.push(job.memory_id);
    else active.push({ memory, documents: memoryVectorDocuments(memory) });
  }

  const flattened = active.flatMap((item) => item.documents.map((document) => ({ ...document, memory: item.memory })));
  const vectors = await embedDocuments(flattened, { provider, embedder, fetchImpl, renew });
  const points = flattened.map((item, index) => vectorPoint(item, vectors[index]));
  // Prepare embeddings before replacing existing points. Provider failures leave
  // the old index intact and the durable jobs available for retry.
  renew();
  await deleteQdrantMemories(store, jobs.map((job) => job.memory_id), { fetchImpl });
  if (points.length) await upsertQdrantPoints(store, points.map((item) => item.point), { fetchImpl });
  renew();
  persistVectorState(db, { active, identity, store });
  for (const id of removed) clearVectorJob(db, id);
  return { processed: jobs.length, indexed: active.length };
}

async function embedDocuments(items, { provider, embedder, fetchImpl, renew }) {
  if (!items.length) return [];
  const batchSize = clampInteger(vectorEnvValue("MOSS_VECTOR_EMBED_BATCH", DEFAULT_EMBED_BATCH), 1, 256, DEFAULT_EMBED_BATCH);
  const vectors = [];
  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);
    renew();
    vectors.push(...await embedder(batch.map((item) => item.text), { config: provider, fetchImpl }));
  }
  return vectors;
}

function vectorPoint(item, vector) {
  const projectionHash = hashText(item.text);
  return {
    point: {
      id: qdrantPointId(item.memory.id, item.chunk_index),
      vector: Array.from(vector),
      payload: {
        memory_id: item.memory.id,
        chunk_index: item.chunk_index,
        chunk_kind: item.chunk_kind,
        status: item.memory.status,
        sensitivity: item.memory.sensitivity,
        scope: item.memory.scope,
        family_key: item.memory.family_key,
        layer: item.memory.layer,
        kind: item.memory.kind,
        projection_hash: projectionHash,
      },
    },
    projectionHash,
  };
}

function persistVectorState(db, { active, identity, store }) {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const item of active) {
      const current = getMemory(db, item.memory.id);
      if (!current) {
        db.prepare("UPDATE memory_deletions SET vector_pending = 1 WHERE memory_id = ?").run(item.memory.id);
        continue;
      }
      if (!["active", "superseded"].includes(current.status) || current.content_hash !== item.memory.content_hash || current.updated_at !== item.memory.updated_at) continue;
      markVectorIndexed(db, {
        memoryId: item.memory.id,
        indexIdentity: identity,
        collectionName: store.collection,
        projectionHash: hashText(item.documents.map((doc) => doc.text).join("\n---\n")),
      });
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function hashText(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}
