export function queueMemoryVectorJob(db, memoryId) {
  if (!memoryId) return;
  // A canonical memory change invalidates every derived vector generation for
  // this record.  Old Qdrant collections may still exist, but their state is
  // no longer trusted; switching back to an older provider/model therefore
  // forces a fresh upsert instead of silently reusing stale vectors.
  db.prepare("DELETE FROM memory_vector_state WHERE memory_id = ?").run(memoryId);
  db.prepare(`
    INSERT INTO memory_vector_jobs(memory_id, queued_at)
    VALUES (?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET queued_at=excluded.queued_at
  `).run(memoryId, new Date().toISOString());
}

export function ensureVectorCoverageJobs(db, indexIdentity) {
  const now = new Date().toISOString();
  return Number(db.prepare(`
    INSERT OR IGNORE INTO memory_vector_jobs(memory_id, queued_at)
    SELECT m.id, ?
    FROM memories m
    LEFT JOIN memory_vector_state s
      ON s.memory_id = m.id AND s.index_identity = ?
    WHERE m.status IN ('active', 'superseded')
      AND s.memory_id IS NULL
  `).run(now, indexIdentity).changes || 0);
}

export function listVectorJobs(db, limit = 64, memoryIds = null, indexIdentity = null) {
  const safeLimit = Math.max(1, Math.min(512, Number(limit) || 64));
  const scope = memoryScope("j.memory_id", memoryIds);
  if (indexIdentity && db.prepare("SELECT 1 FROM vector_deployment WHERE id=1").get()) return db.prepare(`
    SELECT m.id AS memory_id, m.updated_at AS queued_at FROM memories m
    LEFT JOIN memory_vector_state s ON s.memory_id=m.id AND s.index_identity=?
    WHERE m.status IN ('active','superseded') AND s.memory_id IS NULL
      AND ${memoryScope("m.id", memoryIds).sql}
    ORDER BY m.updated_at, m.id LIMIT ?
  `).all(indexIdentity, ...scope.ids, safeLimit);
  return db.prepare(`
    SELECT j.memory_id, j.queued_at
    FROM memory_vector_jobs j
    WHERE ${scope.sql}
    ORDER BY j.queued_at ASC, j.memory_id ASC
    LIMIT ?
  `).all(...scope.ids, safeLimit);
}

export function markVectorIndexed(db, {
  memoryId, indexIdentity, collectionName, projectionHash,
}) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO memory_vector_state(
      memory_id, index_identity, collection_name, projection_hash, indexed_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(memory_id, index_identity) DO UPDATE SET
      collection_name=excluded.collection_name,
      projection_hash=excluded.projection_hash,
      indexed_at=excluded.indexed_at
  `).run(memoryId, indexIdentity, collectionName, projectionHash, now);
  const targets = db.prepare("SELECT identity FROM vector_generations WHERE writable=1").all();
  if (targets.every(({ identity }) => db.prepare("SELECT 1 FROM memory_vector_state WHERE memory_id=? AND index_identity=?").get(memoryId, identity))) {
    db.prepare("DELETE FROM memory_vector_jobs WHERE memory_id = ?").run(memoryId);
  }
}

export function clearVectorJob(db, memoryId) {
  db.prepare("DELETE FROM memory_vector_jobs WHERE memory_id = ?").run(memoryId);
}

export function resetVectorState(db, indexIdentity) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM memory_vector_state WHERE index_identity = ?").run(indexIdentity);
    db.prepare(`
      INSERT INTO memory_vector_jobs(memory_id, queued_at)
      SELECT id, ? FROM memories WHERE status IN ('active', 'superseded')
      ON CONFLICT(memory_id) DO UPDATE SET queued_at=excluded.queued_at
    `).run(new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function vectorStateStats(db, indexIdentity, memoryIds = null) {
  const stateScope = memoryScope("memory_id", memoryIds);
  const recordScope = memoryScope("id", memoryIds);
  const indexed = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM memory_vector_state WHERE index_identity = ? AND ${stateScope.sql}
  `).get(indexIdentity, ...stateScope.ids)?.count || 0);
  let pending = Number(db.prepare(`SELECT COUNT(*) AS count FROM memory_vector_jobs WHERE ${stateScope.sql}`)
    .get(...stateScope.ids)?.count || 0);
  const eligible = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM memories WHERE status IN ('active', 'superseded')
      AND ${recordScope.sql}
  `).get(...recordScope.ids)?.count || 0);
  if (db.prepare("SELECT 1 FROM vector_deployment WHERE id=1").get()) {
    const covered = Number(db.prepare(`SELECT COUNT(*) AS n FROM memories m JOIN memory_vector_state s
      ON s.memory_id=m.id AND s.index_identity=? WHERE m.status IN ('active','superseded')
      AND ${memoryScope("m.id", memoryIds).sql}`).get(indexIdentity, ...stateScope.ids).n);
    return { indexed: covered, pending: eligible-covered, eligible };
  }
  return { indexed, pending, eligible };
}

function memoryScope(column, memoryIds) {
  if (memoryIds == null) return { sql: "1", ids: [] };
  const ids = [...new Set(memoryIds)];
  return { sql: ids.length ? `${column} IN (${ids.map(() => "?").join(",")})` : "0", ids };
}
