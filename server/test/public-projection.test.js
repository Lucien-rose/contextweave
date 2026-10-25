import assert from "node:assert/strict";
import test from "node:test";
import { projectExpansionForPublic, projectRecallForPublic } from "../src/public-projection.js";

test("public recall projection exposes structure without private memory text or identifiers", () => {
  const payload = {
    route: "RECALL",
    memories: [{
      id: "private:subject:symbolic-anchor",
      title: "Confidential symbolic anchor",
      excerpt: "Confidential relationship sentence.",
      content: "private body",
      recall_tier: "T1",
      recall_role: "supporting",
      evidence_type: "related_context",
      recall_path: ["query", "soft anchor", "Confidential symbolic anchor"],
      source_channels: ["formal", "vector", "context-envelope"],
      score: 18.376,
      expandable: true,
      content_available: true,
      detail_level: "cue",
      sensitivity: "intimate",
      source: { file: "private.json" },
    }],
  };
  const result = projectRecallForPublic(payload);
  const text = JSON.stringify(result);
  assert.equal(result.memories[0].tier, "T1");
  assert.deepEqual(result.memories[0].path_shape, ["query", "one-hop"]);
  assert.equal(result.memories[0].score, 18.38);
  for (const secret of ["Confidential symbolic anchor", "Confidential relationship sentence", "private:subject", "private body", "private.json", "intimate"]) {
    assert.equal(text.includes(secret), false, `projection leaked ${secret}`);
  }
});

test("synthetic projection may expose demo text while preserving the same structural contract", () => {
  const result = projectRecallForPublic({
    route: "RECALL",
    memories: [{
      id: "demo:beverage:1",
      demo_synthetic: true,
      title: "Recent beverage preference",
      excerpt: "Avery currently prefers lightly sweet milk tea.",
      recall_tier: "T0",
      recall_role: "factual",
      evidence_type: "direct_fact",
      recall_path: ["query", "direct match", "Recent beverage preference"],
      source_channels: ["formal"],
      score: 12,
      expandable: true,
      content_available: true,
      detail_level: "summary",
    }],
  }, { synthetic: true });
  assert.equal(result.memories[0].title, "Recent beverage preference");
  assert.match(result.memories[0].excerpt, /milk tea/);
  assert.deepEqual(result.memories[0].recall_path, ["query", "direct match", "Recent beverage preference"]);
});

test("public expansion projection hides real chunks unless the caller declares synthetic data", () => {
  const expansion = {
    memory_id: "private:42",
    available: true,
    detail_level: "relevant_chunk",
    content: "Confidential private evidence",
    truncated: false,
  };
  const safe = projectExpansionForPublic(expansion);
  assert.equal(JSON.stringify(safe).includes("Confidential private evidence"), false);
  const demo = projectExpansionForPublic({ ...expansion, demo_synthetic: true, content: "Synthetic evidence" }, { synthetic: true });
  assert.equal(demo.excerpt, "Synthetic evidence");
});

test("synthetic text mode fails closed for records without the demo marker", () => {
  assert.throws(() => projectRecallForPublic({ memories: [{ id: "private:1", title: "do not expose" }] }, { synthetic: true }), /synthetic demo records only/);
});
