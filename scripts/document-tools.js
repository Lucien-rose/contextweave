import { writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMemoryServer } from "../server/src/mcp/memory-server.js";
import { openDatabase } from "../server/src/database.js";
import { assertMcpSurface } from "../server/src/mcp/surfaces.js";
const surface = assertMcpSurface(process.argv[2] || "compat");
const suffix = surface === "compat" ? "" : `_${surface.toUpperCase()}`;
const jsonPath = `docs/TOOLS${suffix}.json`;
const markdownPath = `docs/TOOLS${suffix}.md`;
const { db } = openDatabase(":memory:");
const server = createMemoryServer(db, { surface });
const client = new Client({ name: "contract-docs", version: "1" });
const [a, b] = InMemoryTransport.createLinkedPair();
try {
  await server.connect(a);
  await client.connect(b);
  const { tools } = await client.listTools();
  const surfaceNote = surface === "compat"
    ? "Deprecated combined compatibility inventory. New clients should use the runtime or admin surface."
    : `${surface[0].toUpperCase()}${surface.slice(1)} surface inventory.`;
  writeFileSync(jsonPath, JSON.stringify(tools, null, 2) + "\n");
  writeFileSync(markdownPath, `# MCP ${surface} tools\n\n${surfaceNote} Generated from tools/list with public default configuration. Live tools/list is authoritative after overrides. Character budgets use UTF-16 code units, not tokens. Inspect inputSchema for minimum, maximum and default.\n\n` + tools.map(t => `## ${t.name}\n\n${t.description}\n\n` + "```json\n" + JSON.stringify(t.inputSchema, null, 2) + "\n```\n").join("\n"));
  console.log(`Documented ${tools.length} ${surface} tools`);
} finally { await client.close(); await server.close(); db.close(); }
