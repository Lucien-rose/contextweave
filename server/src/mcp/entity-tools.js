import { result } from "./shared.js";
import { entityLinkSchema, entityListSchema, entityReadSchema, entityWriteSchema } from "../entity/contract.js";
import { linkEntity, listEntities, readEntity, saveEntity } from "../entity/service.js";

export function registerEntityTools(server, { db }) {
  for (const [name, schema, action, readOnly, description] of [
    ["moss_entity_save", entityWriteSchema, saveEntity, false,
      "Create a deliberately identified entity or revise its exact stable ID. Supply type, display name and explicit aliases. Namespace defaults to real; give fictional works/branches distinct namespaces. Namespace is immutable. Never merge entities based on name similarity or infer factual relationships."],
    ["moss_entity_list", entityListSchema, listEntities, true,
      "List context-visible entity headers. Aliases connect names for discovery only; they grant no factual answer authority."],
    ["moss_entity_read", entityReadSchema, readEntity, true,
      "Read one context-visible entity header by stable ID, without memory bodies."],
    ["moss_entity_link", entityLinkSchema, linkEntity, false,
      "Attach or detach an inspected exact memory ID to an inspected entity ID. This is navigation/discovery metadata, not evidence of a factual relationship; originals and recall authority are unchanged."],
  ]) {
    server.registerTool(name, { description, inputSchema: schema.shape,
      annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly || name === "moss_entity_link" } },
    async (input) => result(action(db, input)));
  }
}
