import { transaction } from "../lib/transaction.js";
import { publicError } from "../lib/error.js";
import { parseContract } from "../lib/contract.js";
import { portraitHash } from "../portrait/store.js";
import { recordSourceMaterial } from "../source-materials.js";
import { sensitivityRank } from "../portrait/runtime-contract.js";
import { portraitVisible } from "../portrait/read.js";
import { publishCapsuleSchema, capsuleCatalogSchema, capsuleReadSchema } from "./contract.js";

export { ensureWindowCapsuleSchema } from "./schema.js";

export function publishWindowCapsule(db, rawInput) {
  const input = parseContract(publishCapsuleSchema, rawInput);
  const fingerprint = portraitHash(input);
  return transaction(db, () => {
    const previous = db.prepare("SELECT * FROM window_capsules WHERE change_id=?").get(input.change_id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw publicError("Capsule change ID reused with different content", 409);
      return { ...receipt(previous), duplicate: true };
    }
    const current = db.prepare("SELECT * FROM window_capsules WHERE source_surface=? AND window_id=? ORDER BY version DESC LIMIT 1")
      .get(input.source_surface, input.window_id);
    if ((current?.version || 0) !== input.expected_version || (current && (input.source_revision <= current.source_revision
      || input.session_id !== current.session_id))) throw publicError("Capsule source/version changed; inspect the latest published version", 409);
    const sourceRefs = input.source_refs.map((source) => {
      const material = source.source_context ? recordSourceMaterial(db, source)
        : source.material_id ? db.prepare("SELECT sensitivity FROM source_materials WHERE id=?").get(source.material_id) : null;
      const level = material?.sensitivity || source.source_context?.sensitivity;
      if (level && sensitivityRank[level] > sensitivityRank[input.sensitivity]) throw publicError("Capsule must preserve source sensitivity", 403);
      const { source_context, ...ref } = source;
      return { ...ref, ...(material?.id ? { material_id: material.id } : {}) };
    });
    const version = input.expected_version + 1;
    const id = `window:${portraitHash([input.source_surface, input.window_id, version]).slice(0, 40)}`;
    const publishedAt = new Date().toISOString();
    db.prepare("INSERT INTO window_capsules VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.change_id, fingerprint, input.window_id, input.source_surface, input.session_id, input.source_revision,
        version, input.sensitivity, input.data.title, JSON.stringify(input.data), JSON.stringify(sourceRefs), publishedAt);
    return receipt(db.prepare("SELECT * FROM window_capsules WHERE id=?").get(id));
  });
}

export function windowCapsuleCatalog(db, rawInput = {}) {
  const input = parseContract(capsuleCatalogSchema, rawInput);
  const visible = input.context !== "general";
  const intimate = ["proactive", "scene"].includes(input.intimacy_mode);
  const rows = db.prepare(`SELECT c.id, c.window_id, c.source_surface, c.session_id, c.source_revision,
    c.version, c.sensitivity, c.title, c.published_at FROM window_capsules c
    WHERE ? AND (? OR c.sensitivity!='intimate') AND (? IS NULL OR c.source_surface=?) AND NOT EXISTS (
      SELECT 1 FROM window_capsules newer WHERE newer.source_surface=c.source_surface AND newer.window_id=c.window_id
        AND newer.version>c.version) ORDER BY c.published_at DESC, c.id LIMIT ? OFFSET ?`)
    .all(Number(visible), Number(intimate), input.source_surface || null, input.source_surface || null, input.limit + 1, input.offset);
  return { authority: "published-capsules-only", windows_owned_by_host: true,
    items: rows.slice(0, input.limit).map((row) => ({ ...receipt(row), title: row.title,
      read_via: { tool: "moss_window_capsule_read", arguments: { capsule_id: row.id, context: input.context, intimacy_mode: input.intimacy_mode } } })),
    next_offset: rows.length > input.limit ? input.offset + input.limit : null };
}

export function readWindowCapsule(db, rawInput) {
  const input = parseContract(capsuleReadSchema, rawInput);
  const row = db.prepare("SELECT * FROM window_capsules WHERE id=?").get(input.capsule_id);
  if (!row || !portraitVisible(row, input)) throw publicError("Visible window capsule not found", 404);
  return { ...receipt(row), data: JSON.parse(row.data_json), source_refs: JSON.parse(row.source_refs_json),
    guidance: "Published orientation, not a transcript or live window state. Host selects the window and composes Handoff." };
}

function receipt(row) {
  return { capsule_id: row.id, window_id: row.window_id, source_surface: row.source_surface, session_id: row.session_id,
    source_revision: row.source_revision, version: row.version, sensitivity: row.sensitivity, published_at: row.published_at };
}
