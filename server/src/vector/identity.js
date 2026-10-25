import { createHash } from "node:crypto";
import { providerIdentity, vectorProviderConfig } from "../vector-provider.js";
import { bodyPolicy } from "../vector-projection.js";
export const PROJECTION_VERSION = "semantic-v4-summary-policy";
export function vectorIndexIdentity(provider = vectorProviderConfig()) {
  return createHash("sha256")
    .update(`${providerIdentity(provider)}\n${PROJECTION_VERSION}\n${bodyPolicy()}`, "utf8")
    .digest("hex");
}
