import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createDemoRepository } from "../../demo/recall-repository.js";
import { progressiveRecall } from "../src/recall/progressive.js";

const fixture = JSON.parse(readFileSync(new URL("../../demo/fixtures/recall-core.json", import.meta.url), "utf8"));
const input = { context: "private", intimacyMode: "off", recordRecall: false, shadowMode: "off" };

test("exported core runs real recall with only a repository and synthetic records", async () => {
  const repository = createDemoRepository(fixture.memories);
  const direct = await progressiveRecall(repository, { ...input, query: "Cobalt release decision" });
  assert.deepEqual(direct.memories.map(({ id }) => id), ["demo:decision"]);
  assert.equal(direct.memories[0].recall_tier, "T0");
  assert.equal(direct.trace.pipeline_passes, 1);
  const contextual = await progressiveRecall(repository, { ...input, query: "Which plan did we settle on?",
    queryRepresentation: { topics: ["Cobalt deployment"] } });
  assert.deepEqual(contextual.memories.map(({ id }) => id), ["demo:decision"]);
  assert.equal(contextual.memories[0].recall_tier, "T1");
  const unrelated = await progressiveRecall(repository, { ...input, query: "telescope optics" });
  assert.deepEqual(unrelated.memories, []);
  const blocked = await progressiveRecall(repository, { ...input, query: "Cobalt release decision",
    recallControl: { mode: "no_recall", source: "client" } });
  assert.deepEqual(blocked.memories, []);
});

test("exported orchestrator accepts vector functions without private runtime imports", async () => {
  const calls = [];
  const vectors = {
    primary: async () => { calls.push("primary"); return { enabled: true, mode: "on", items: [] }; },
    association: async ({ seedIds }) => {
      calls.push(seedIds);
      return { enabled: true, mode: "on", items: [] };
    },
  };
  const result = await progressiveRecall(createDemoRepository(fixture.memories),
    { ...input, query: "Cobalt release decision" }, vectors);
  assert.deepEqual(calls, ["primary", ["demo:decision"]]);
  assert.equal(result.trace.pipeline_passes, 2);
  assert.equal(result.memories[0].id, "demo:decision");
});
