import { readFileSync } from "node:fs";

const packageUrl = new URL("../../package.json", import.meta.url);
const packageMetadata = JSON.parse(readFileSync(packageUrl, "utf8"));

export const VERSION = String(packageMetadata.version);
