import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { withMcp, callTool } from "../../scripts/mcp-client.js";

export async function runExample({ baseUrl = process.env.MOSS_BASE_URL || "http://127.0.0.1:2091",
  token = process.env.MOSS_RUNTIME_TOKEN } = {}) {
  if (!token) throw new Error("Set MOSS_RUNTIME_TOKEN before running the example");
  return withMcp(baseUrl, "runtime", token, async client => {
    const recall = query => callTool(client, "moss_recall", { query, context: "private", intimacy_mode: "off",
      vector_mode: "off", jev_mode: "off", recall_control: { mode: "suppress_situation" } });
    const imported = await recall("Harbor project launch color");
    assert.ok(JSON.stringify(imported).includes("cobalt blue"), "Import examples/host/memories.json first");
    const marker = `Harbor-${randomUUID()}`;
    const draft = await callTool(client, "moss_draft", {
      title: marker, content: `${marker}: The host received a message asking for jasmine tea.`,
      sensitivity: "personal", tags: [marker],
      source_refs: [{ source_type: "conversation", source_id: marker, excerpt: "Please remember my jasmine tea request." }],
    });
    // This example explicitly confirms its own synthetic message.
    const committed = await callTool(client, "moss_commit", { draft_id: draft.draft.id, confirmation: true });
    assert.equal(committed.committed, true);
    const recalled = await recall(marker);
    assert.ok(JSON.stringify(recalled).includes("jasmine tea"), "Committed message must be recalled");
    console.log("PASS: imported memory recalled; host message saved and recalled through Runtime MCP.");
    return { imported: "example:harbor", created: draft.draft.id };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await runExample(); }
  catch (error) { console.error(`Host example failed: ${error.message}`); process.exitCode = 1; }
}
