import { readFileSync, writeFileSync } from "node:fs";
import { describeApi } from "../server/src/api/v1/contract.js";

const operations = describeApi().operations;
const classes = new Map();
const nameOf = value => value.split(/[^a-zA-Z0-9]+/).map(part => part[0].toUpperCase() + part.slice(1)).join("");
function type(schema, name) {
  if (schema.$ref || schema.allOf || schema.oneOf) throw new Error("Unsupported Python input schema");
  if (schema.const !== undefined) return `Literal[${JSON.stringify(schema.const)}]`;
  if (schema.enum) return `Literal[${schema.enum.map(value => JSON.stringify(value)).join(", ")}]`;
  if (schema.anyOf) return schema.anyOf.map((item, i) => type(item, `${name}${i}`)).join(" | ");
  if (Array.isArray(schema.type)) return schema.type.map(value => type({ ...schema, type: value }, name)).join(" | ");
  switch (schema.type) {
    case "string": return "str";
    case "integer": return "int";
    case "number": return "float";
    case "boolean": return "bool";
    case "null": return "None";
    case "array": return `list[${type(schema.items, `${name}Item`)}]`;
    case "object": {
      if (!schema.properties) return `dict[str, ${schema.additionalProperties && typeof schema.additionalProperties === "object" ? type(schema.additionalProperties, `${name}Value`) : "object"}]`;
      const fields = Object.entries(schema.properties).map(([key, value]) => {
        const field = type(value, name + nameOf(key));
        return `    ${key}: ${schema.required?.includes(key) ? field : `NotRequired[${field}]`}`;
      });
      classes.set(name, `class ${name}(TypedDict):\n${fields.join("\n")}\n`);
      return name;
    }
    default: return "object";
  }
}
for (const operation of operations.filter(item => item.input)) type(operation.input, `${nameOf(operation.name)}Input`);
const requests = "# Generated from HTTP API v1. Run npm run python:generate.\nfrom typing import Literal, NotRequired, TypedDict\n\n\n" + [...classes.values()].join("\n\n");
const results = { ingest: "WriteResult", evolve: "WriteResult", recall: "RecallResult", read: "ReadResult", bootstrap: "BootstrapResult", delivered: "DeliveryResult", change: "ChangeReceipt", reviews: "ReviewsResult", schema: "SchemaResult" };
function surface(async, admin = false) {
  const prefix = async ? "Async" : "";
  const base = admin ? `${prefix}ContextWeave` : `${async ? "Async" : "Sync"}Transport`;
  const members = [...operations, { name: "schema", path: "/api/v1/schema", role: "runtime" }].filter(item => (item.role === "admin") === admin);
  return `class ${prefix}ContextWeave${admin ? "Admin" : ""}(${base}):\n` + members.map(op => {
    const name = op.name === "delivered" ? "acknowledge" : op.name;
    const input = op.input ? `, input: ${nameOf(op.name)}Input${op.name === "bootstrap" ? " | None = None" : ""}` : "";
    return `    ${async ? "async " : ""}def ${name}(self${input}, *, timeout: float | None = None) -> ApiResponse[${results[op.name]}]:\n        return ${async ? "await " : ""}self._request(${JSON.stringify(op.path.replace("/api/v1/", ""))}${op.input ? `, ${op.name === "bootstrap" ? "{} if input is None else input" : "input"}` : ""}, timeout=timeout)\n`;
  }).join("\n");
}
const client = "# Generated from HTTP API v1. Run npm run python:generate.\nfrom ._transport import AsyncTransport, SyncTransport\nfrom .requests import " + operations.filter(op => op.input).map(op => `${nameOf(op.name)}Input`).join(", ") + "\nfrom .types import ApiResponse, " + [...new Set(Object.values(results))].join(", ") + "\n\n\n" + [surface(false), surface(false, true), surface(true), surface(true, true)].join("\n\n");
for (const [name, output] of [["requests.py", requests], ["client.py", client]]) {
  const file = new URL(`../packages/sdk-python/src/contextweave/${name}`, import.meta.url);
  if (process.argv.includes("--check")) {
    if (readFileSync(file, "utf8") !== output) throw new Error(`Python ${name} is stale; run npm run python:generate`);
  } else writeFileSync(file, output);
}
