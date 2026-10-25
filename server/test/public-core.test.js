import assert from "node:assert/strict";
import test from "node:test";
import { assignRecallSemantics } from "../src/recall/tiering.js";
import { normalizeContextEnvelope } from "../src/recall/context.js";
import { evaluateMemoryCandidate } from "../src/memory-policy.js";

test("public core tiering keeps direct, one-hop and ambient roles structurally distinct", () => {
  const baseMemory = {
    id: "demo:1", title: "Synthetic preference", content: "synthetic", tags: [], triggers: [], ambient_triggers: [],
    kind: "memory", load_policy: "contextual", standing_opt_in: false, activation_policy: "explicit_trigger",
  };
  const [direct, oneHop, ambient] = assignRecallSemantics([
    { memory: baseMemory, rawDirectEvidence: true },
    { memory: { ...baseMemory, id: "demo:2" }, vectorEvidence: true },
    { memory: { ...baseMemory, id: "demo:3", standing_opt_in: true, activation_policy: "relationship_contextual" } },
  ]);
  assert.deepEqual([direct.recallTier, direct.recallRole], ["T0", "factual"]);
  assert.deepEqual([oneHop.recallTier, oneHop.recallRole], ["T1", "supporting"]);
  assert.deepEqual([ambient.recallTier, ambient.recallRole], ["T1", "ambient"]);
});

test("public core context envelope remains generic and bounded", () => {
  const value = normalizeContextEnvelope({ topics: ["beverage", "taste"], recall_hypotheses: ["find relevant taste preferences"] });
  assert.deepEqual(value.topics, ["beverage", "taste"]);
  assert.equal(value.hypotheses[0], "find relevant taste preferences");
  assert.ok(value.hypotheses.includes("beverage taste"));
});

test("public memory candidate policy delegates clear writes but keeps deletion explicit", () => {
  const identity = evaluateMemoryCandidate({ candidate_kind: "identity", confidence: 1, meaning_score: 1, source_refs: [{ source_id: "demo" }] });
  assert.equal(identity.decision, "auto-save");
  assert.equal(identity.requires_confirmation, false);
  const deletion = evaluateMemoryCandidate({ candidate_kind: "deletion", confidence: 1, meaning_score: 1, source_refs: [{ source_id: "demo" }] });
  assert.equal(deletion.decision, "confirm");
  assert.equal(deletion.requires_confirmation, true);
});
