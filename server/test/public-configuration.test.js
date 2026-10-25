import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// Node's test runner isolates this deployment configuration in its own process.
Object.assign(process.env, {
  CW_MAIN_CHARS: "4200", CW_TOTAL_CHARS: "9000", CW_RECALL_ITEMS: "3",
  CW_HISTORY_CHARS: "18000", CW_PORTRAIT_OPERATIONS: "2", CW_MEMORY_CANDIDATES: "1",
  CW_LIVING_DAYS: "5", CW_EXPIRED_GRACE_DAYS: "10",
});
const { createMemoryServer } = await import("../src/mcp/memory-server.js");
const { openDatabase } = await import("../src/database.js");
const { createDemoRepository } = await import("../../demo/recall-repository.js");
const { progressiveRecall } = await import("../src/recall/progressive.js");
const { runtimeSettingsSchema, writerProposalSchema, jsonOutputSchema } = await import("../src/portrait/runtime-contract.js");
const { portraitHousekeeping } = await import("../src/portrait/lifecycle.js");

test("deployment overrides reach MCP schemas, recall budgets and portrait processing", async () => {
  const { db } = openDatabase(":memory:");
  assert.equal(db.prepare("PRAGMA database_list").get().file, "");
  const server = createMemoryServer(db);
  const client = new Client({ name: "configuration-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(a);
    await client.connect(b);
    const { tools } = await client.listTools();
    const recall = tools.find(tool => tool.name === "moss_recall").inputSchema.properties;
    assert.equal(recall.context_budget_chars.default, 4200);
    assert.equal(recall.total_budget_chars.default, 9000);
    assert.equal(recall.limit.default, 3);
    const history = tools.find(tool => tool.name === "moss_family_history").inputSchema.properties;
    assert.equal(history.max_chars.default, 18000);
    assert.equal(history.max_chars.minimum, 12000);
    const rejected = await client.callTool({ name: "moss_family_history", arguments: { family_key: "test:lineage", max_chars: 5000 } });
    assert.equal(rejected.isError, true);
    const accepted = await client.callTool({ name: "moss_family_history", arguments: { family_key: "test:lineage" } });
    assert.notEqual(accepted.isError, true);

    const fixture = JSON.parse(readFileSync(new URL("../../demo/fixtures/recall-core.json", import.meta.url), "utf8"));
    const result = await progressiveRecall(createDemoRepository(fixture.memories), {
      query: "Cobalt release decision", context: "private", recordRecall: false, shadowMode: "off",
    });
    assert.equal(result.memories[0].id, "demo:decision");
    assert.equal(result.trace.context_budget.char_budget, 4200);
    assert.equal(result.trace.total_context_budget.total_limit, 9000);
    assert.equal(runtimeSettingsSchema.parse({}).living_days, 5);
    const writer = jsonOutputSchema(writerProposalSchema).properties;
    assert.equal(writer.portrait_changes.maxItems, 2);
    assert.equal(writer.memory_candidates.maxItems, 1);
    assert.equal(portraitHousekeeping(db).expired_grace_days, 10);
  } finally {
    await client.close();
    await server.close();
    db.close();
  }
});
