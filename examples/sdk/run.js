import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ContextWeave } from "../../packages/sdk-typescript/dist/index.js";

export async function runSdkExample({ baseUrl = process.env.MOSS_BASE_URL || "http://127.0.0.1:2091",
  token = process.env.MOSS_RUNTIME_TOKEN } = {}) {
  const moss = new ContextWeave({ baseUrl, token });
  const marker = `Harbor-${randomUUID()}`;
  const { data: saved } = await moss.ingest({
    change_id: marker, family_key: marker, title: marker,
    content: `${marker}: The launch color is cobalt blue.`,
    authority: "user_correction", user_instruction: "Save this synthetic SDK example record.",
    attributes: { sensitivity: "personal", triggers: [marker] },
    source_refs: [{ source_type: "example", source_id: marker }],
  });
  assert.equal(saved.status, "applied");
  const { data: recalled } = await moss.recall({ query: marker, delivery_mode: "confirmed", vector_mode: "off", jev_mode: "off" });
  assert.ok(recalled.memories.some(memory => memory.id === saved.memory_id));
  const { data: memory } = await moss.read({ memory_id: saved.memory_id, query: marker, detail: "full" });
  assert.equal(memory.available, true);
  assert.match(memory.content, /cobalt blue/);
  // A real host acknowledges only after the selected memory reaches model context.
  const { data: delivered } = await moss.acknowledge({ receipt_id: recalled.delivery.receipt_id, memory_ids: [saved.memory_id] });
  assert.equal(delivered.status, "delivered");
  console.log("PASS: TypeScript SDK ingested, recalled, read and acknowledged a synthetic memory.");
  return saved;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await runSdkExample(); }
  catch (error) { console.error(`SDK example failed: ${error.message}`); process.exitCode = 1; }
}
