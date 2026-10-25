import { result } from "./shared.js";
import {
  arcAttachSchema, arcCreateSchema, arcIdSchema, arcListSchema, arcMaterialRefSchema,
  arcMaterialsSchema, arcReadSchema, arcRenameSchema,
} from "../arc/contract.js";
import {
  archiveArc, attachArcMaterial, createArc, detachArcMaterial, listArcMaterials,
  listArcs, readArc, renameArc,
} from "../arc/service.js";

export function registerArcTools(server, { db }) {
  const tools = [
    ["moss_arc_create", arcCreateSchema, createArc, false,
      "Create a manually chosen long-running story/project Atlas. It links independent records across families without merging them. Mark intimate themes intimate. Never infer an Atlas merely from similarity."],
    ["moss_arc_list", arcListSchema, listArcs, true,
      "List private Atlas headers with optional literal title search. Archived Atlases require status=archived or all. No material bodies are included."],
    ["moss_arc_read", arcReadSchema, readArc, true,
      "Read one Atlas header only. Use moss_arc_materials with a chapter or literal query to navigate relevant materials, then their original readers when needed."],
    ["moss_arc_rename", arcRenameSchema, renameArc, false,
      "Rename one active Atlas. This changes its navigation label only, never the linked records or recall evidence."],
    ["moss_arc_archive", arcIdSchema, archiveArc, false,
      "Archive one Atlas when the user or host intentionally closes that story. It becomes read-only; every linked original keeps its own status and identity."],
    ["moss_arc_attach", arcAttachSchema, attachArcMaterial, false,
      "Attach an inspected memory, family key, handoff, or stored source material to an active Atlas, with optional chapter and position. Reattaching updates placement. One material may belong to multiple Atlases. This grants no answer authority or longer retention."],
    ["moss_arc_detach", arcMaterialRefSchema, detachArcMaterial, false,
      "Detach an exact material reference from an active Atlas. Never deletes or changes the original, other Atlases, or family history."],
    ["moss_arc_materials", arcMaterialsSchema, listArcMaterials, true,
      "Return a bounded, body-free list of visible material references in curated order. Filter by chapter or case-insensitive literal query over permitted originals. Lineage references follow versions; memory/source references pin identity. Atlas membership is navigation only, not evidence of relevance, currentness, or factual authority. Hidden or purged materials are omitted. Use original readers to inspect content."],
  ];
  for (const [name, schema, handler, readOnly, description] of tools) {
    server.registerTool(name, {
      description, inputSchema: schema.shape,
      annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
    }, async (input) => result(handler(db, input)));
  }
}
