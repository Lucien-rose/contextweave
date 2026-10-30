import { writeFileSync, readFileSync } from "node:fs";
import { describeApi } from "../server/src/api/v1/contract.js";
import ts from "typescript";

// Input defaults stay optional. Semantic refinements remain server-authoritative.
function type(schema) {
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map(value => JSON.stringify(value)).join(" | ");
  if (schema.anyOf) return schema.anyOf.map(type).join(" | ");
  if (Array.isArray(schema.type)) return schema.type.map(value => type({ ...schema, type: value })).join(" | ");
  switch (schema.type) {
    case "string": case "boolean": case "null": return schema.type;
    case "integer": case "number": return "number";
    case "array": return `Array<${type(schema.items)}>`;
    case "object": {
      const fields = Object.entries(schema.properties || {}).map(([name, field]) =>
        `${JSON.stringify(name)}${schema.required?.includes(name) ? "" : "?"}: ${type(field)};`);
      if (schema.additionalProperties !== false) fields.push(`[key: string]: ${typeof schema.additionalProperties === "object" ? type(schema.additionalProperties) : "unknown"};`);
      return `{ ${fields.join(" ")} }`;
    }
    default:
      if (Object.keys(schema).some(key => ["$ref", "allOf", "oneOf"].includes(key))) throw new Error("Unsupported SDK input schema");
      return "unknown";
  }
}

const source = "// Generated from HTTP API v1. Run npm run sdk:generate.\n\n" + describeApi().operations
  .filter(operation => operation.input)
  .map(operation => `export type ${operation.name[0].toUpperCase()}${operation.name.slice(1)}Input = ${type(operation.input)};\n`).join("\n");
const output = ts.createPrinter().printFile(ts.createSourceFile("requests.ts", source, ts.ScriptTarget.Latest, true));
const file = new URL("../packages/sdk-typescript/src/requests.ts", import.meta.url);
if (process.argv.includes("--check")) {
  if (readFileSync(file, "utf8") !== output) throw new Error("SDK request types are stale; run npm run sdk:generate");
} else writeFileSync(file, output);
