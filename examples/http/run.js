import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export async function runHttpExample({ baseUrl = process.env.MOSS_BASE_URL || "http://127.0.0.1:2091",
  token = process.env.MOSS_RUNTIME_TOKEN } = {}) {
  if (!token) throw new Error("Set MOSS_RUNTIME_TOKEN before running the example");
  const call = async (path, input) => {
    const response = await fetch(new URL(`/api/v1/${path}`, baseUrl), {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input), signal: AbortSignal.timeout(30000),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`${payload.error.code}: ${payload.error.message}`);
    return payload.data;
  };
  const marker = `Harbor-${randomUUID()}`;
  // Running this example explicitly saves its own synthetic record.
  const saved = await call("ingest", {
    change_id: marker, family_key: marker, title: marker,
    content: `${marker}: The launch color is cobalt blue.`,
    authority: "user_correction", user_instruction: "Save this synthetic example record.",
    attributes: { sensitivity: "personal", triggers: [marker] },
    source_refs: [{ source_type: "example", source_id: marker, excerpt: "The launch color is cobalt blue." }],
  });
  assert.equal(saved.status, "applied", "A review_required result is not a saved memory");
  const recalled = await call("recall", { query: marker, delivery_mode: "confirmed", vector_mode: "off", jev_mode: "off" });
  assert.ok(recalled.memories.some(memory => memory.id === saved.memory_id));
  const memory = await call("read", { memory_id: saved.memory_id, query: marker, detail: "full" });
  assert.match(memory.content, /cobalt blue/);
  // A real host sends this receipt only after injecting the selected IDs.
  const delivered = await call("recall/delivered", {
    receipt_id: recalled.delivery.receipt_id, memory_ids: [saved.memory_id],
  });
  assert.equal(delivered.status, "delivered");
  console.log("PASS: HTTP v1 ingested, recalled, read and acknowledged a synthetic memory.");
  return { memory_id: saved.memory_id };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await runHttpExample(); }
  catch (error) { console.error(`HTTP example failed: ${error.message}`); process.exitCode = 1; }
}
