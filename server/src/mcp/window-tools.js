import { capsuleReadSchema, capsuleCatalogSchema } from "../window/contract.js";
import { readWindowCapsule, windowCapsuleCatalog } from "../window/store.js";
import { result, errorResult } from "./shared.js";

export function registerWindowTools(server, { db }) {
  for (const [name, schema, action, description] of [
    ["moss_window_capsules", capsuleCatalogSchema, windowCapsuleCatalog,
      "List published Session Capsule headers, not an authoritative active-window directory. The host selects windows; never substitute the newest window for an explicit selection."],
    ["moss_window_capsule_read", capsuleReadSchema, readWindowCapsule,
      "Read one exact published Session Capsule including its unfinished items. This is orientation, not a transcript or live session state. Handoff composition and context injection belong to the host."],
  ]) server.registerTool(name, { description, inputSchema: schema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }, async (input) => {
    try { return result(action(db, input)); }
    catch (error) { if (error.publicMessage) return errorResult(error.publicMessage); throw error; }
  });
}
