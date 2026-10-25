import { transaction } from "../lib/transaction.js";
import { randomUUID, createHash } from "node:crypto";
import { vectorProviderConfig } from "../vector-provider.js";
import { qdrantConfig } from "../vector-store.js";
import { createModelSettingsStore, connectionFingerprint } from "../models/settings.js";
import { vectorIndexIdentity } from "./identity.js";
import { publicError } from "../lib/error.js";

export { ensureVectorDeploymentSchema } from "./schema.js";

export function vectorDeployment(db) {
  return db.prepare("SELECT * FROM vector_deployment WHERE id=1").get() || null;
}

export function loadVectorGeneration(db, identity, secrets = createModelSettingsStore()) {
  const row = db.prepare("SELECT * FROM vector_generations WHERE identity=?").get(identity);
  if (!row) throw publicError("Vector generation not found", 404);
  const config = secrets.unseal(row.config_sealed);
  if (vectorIndexIdentity(config.provider) !== identity) throw publicError("Vector projection policy changed; start a new migration", 409);
  return { ...config, identity };
}

export function activeVectorIndex(db) {
  const deployment = vectorDeployment(db);
  if (deployment) return loadVectorGeneration(db, deployment.active_identity);
  const provider = vectorProviderConfig();
  const identity = vectorIndexIdentity(provider);
  return { provider, identity, store: qdrantConfig({ indexIdentity: identity, dimensions: provider.dimensions }) };
}

export function beginVectorMigration(db, { connection_id, mode = "dual" }, secrets = createModelSettingsStore()) {
  if (!["dual", "forced"].includes(mode)) throw publicError("Migration mode must be dual or forced");
  const connection = secrets.get(connection_id);
  if (!connection.capabilities.includes("embedding") || connection.tested?.embedding !== connectionFingerprint(connection)) {
    throw publicError("Test the candidate embedding connection first", 409);
  }
  const provider = vectorProviderConfig({ baseUrl: connection.base_url, model: connection.model,
    dimensions: connection.dimensions, apiKey: connection.api_key, timeoutMs: connection.timeout_ms });
  provider.connection = connection;
  provider.provider = connection.protocol === "google" ? "google" : /^https:\/\/api.openai.com\//.test(connection.base_url) ? "openai" : "openai-compatible";
  provider.includeDimensions = connection.include_dimensions;
  const identity = vectorIndexIdentity(provider);
  const green = { provider, identity, store: qdrantConfig({ indexIdentity: identity, dimensions: provider.dimensions }) };
  transaction(db, () => {
    const blue = activeVectorIndex(db);
    if (blue.identity === identity) throw publicError("Candidate must use a different embedding space", 409);
    const current = vectorDeployment(db);
    if (current?.candidate_identity) throw publicError("Finish or cancel the current migration first", 409);
    const insert = db.prepare(`INSERT OR IGNORE INTO vector_generations VALUES (?,?,?,?,?,1,?)`);
    for (const index of [blue, green]) insert.run(index.identity, secrets.seal({ provider: index.provider, store: index.store }),
      index.store.collection, index.provider.model, index.provider.dimensions, new Date().toISOString());
    db.prepare(`UPDATE vector_generations SET writable=CASE WHEN identity=? THEN 1 WHEN identity=? AND ?='dual' THEN 1 ELSE 0 END`).run(green.identity, blue.identity, mode);
    db.prepare(`INSERT INTO vector_deployment VALUES (1,?,?,NULL,?,1,?)
      ON CONFLICT(id) DO UPDATE SET candidate_identity=excluded.candidate_identity,mode=excluded.mode,
      revision=revision+1,updated_at=excluded.updated_at`).run(blue.identity, green.identity, mode, new Date().toISOString());
  });
  return vectorDeploymentStatus(db);
}

export function generationCoverage(db, identity) {
  const eligible = Number(db.prepare("SELECT COUNT(*) AS n FROM memories WHERE status IN ('active','superseded')").get().n);
  const indexed = Number(db.prepare(`SELECT COUNT(*) AS n FROM memories m JOIN memory_vector_state s ON m.id=s.memory_id
    WHERE s.index_identity=? AND m.status IN ('active','superseded')`).get(identity).n);
  return { eligible, indexed, missing: eligible - indexed };
}

export function vectorDeploymentStatus(db) {
  const deployment = vectorDeployment(db);
  return { deployment, generations: db.prepare(`SELECT identity,collection,model,dimensions,writable,created_at FROM vector_generations`).all()
    .map((row) => ({ ...row, ...generationCoverage(db, row.identity) })),
    latest_check: db.prepare(`SELECT id,created_at,result_json FROM vector_migration_checks ORDER BY created_at DESC LIMIT 1`).get() || null };
}

export function switchVectorGeneration(db, { expected_revision, rollback = false, check_id = null }) {
  transaction(db, () => {
    const d = vectorDeployment(db);
    if (!d || d.revision !== expected_revision) throw publicError("Deployment changed; reload status", 409);
    const target = rollback ? d.previous_identity : d.candidate_identity;
    if (!target || generationCoverage(db, target).missing) throw publicError("Target is absent or still has missing vectors", 409);
    const pendingDeletes = db.prepare("SELECT 1 FROM memory_deletions WHERE vector_pending=1 LIMIT 1").get();
    if (pendingDeletes) throw publicError("Finish pending vector deletions first", 409);
    if (!rollback) {
      const check = db.prepare("SELECT * FROM vector_migration_checks WHERE id=? AND deployment_revision=?").get(check_id, d.revision);
      const result = check ? JSON.parse(check.result_json) : null;
      if (!result?.candidate_ok || result.corpus_signature !== corpusSignature(db)) {
        throw publicError("Run a successful shadow comparison and review it first", 409);
      }
    }
    db.prepare(`UPDATE vector_deployment SET active_identity=?, previous_identity=?,candidate_identity=NULL,
      mode='dual',revision=revision+1,updated_at=? WHERE id=1`).run(target, d.active_identity, new Date().toISOString());
    db.prepare("UPDATE vector_generations SET writable=1 WHERE identity IN (?,?)").run(target, d.active_identity);
  });
  return vectorDeploymentStatus(db);
}

export function retirePreviousGeneration(db, expectedRevision) {
  transaction(db, () => {
    const d = vectorDeployment(db);
    if (!d || d.revision !== expectedRevision || d.candidate_identity) throw publicError("Reload status or finish migration first", 409);
    db.prepare("UPDATE vector_generations SET writable=0 WHERE identity!=?").run(d.active_identity);
    db.prepare("UPDATE vector_deployment SET previous_identity=NULL,revision=revision+1,updated_at=? WHERE id=1")
      .run(new Date().toISOString());
  });
  return vectorDeploymentStatus(db);
}

export function cancelVectorMigration(db, expectedRevision) {
  transaction(db, () => {
    const changed = db.prepare(`UPDATE vector_deployment SET candidate_identity=NULL,mode='dual',revision=revision+1,
      updated_at=? WHERE id=1 AND revision=?`).run(new Date().toISOString(), expectedRevision).changes;
    if (!changed) throw publicError("Deployment changed; reload status", 409);
    const d = vectorDeployment(db);
    db.prepare("UPDATE vector_generations SET writable=CASE WHEN identity IN (?,?) THEN 1 ELSE 0 END")
      .run(d.active_identity, d.previous_identity);
  });
  return vectorDeploymentStatus(db);
}

export function corpusSignature(db) {
  return createHash("sha256").update(JSON.stringify(db.prepare(
    "SELECT id,content_hash,updated_at,status FROM memories ORDER BY id").all())).digest("hex");
}

export function saveMigrationCheck(db, deployment, result) {
  const id = randomUUID();
  db.prepare("INSERT INTO vector_migration_checks VALUES (?,?,?,?,?,?)").run(id, deployment.active_identity,
    deployment.candidate_identity, deployment.revision, JSON.stringify({ ...result, corpus_signature: corpusSignature(db) }), new Date().toISOString());
  return { id, ...result };
}
