import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, writeMemory } from "../src/database.js";
import { recallMemoriesWithTrace } from "../src/recall/sqlite.js";
import { buildJevSnapshot } from "../src/recall/jev-snapshot.js";
import { buildJevRequest, judgeJevCandidates } from "../src/recall/jev-provider.js";
import { runSemanticRecall } from "../src/recall/semantic-runtime.js";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "moss-coverage-"));
  const { db } = openDatabase(join(directory, "test.sqlite"));
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  writeMemory(db, { id: "seed", title: "Navigation notebook", content: "Winding trail leads onward.", tags: ["wayfinding"] });
  writeMemory(db, { id: "zz:target", title: "Cabin inspection", content: "Dry shelter beside lake.", tags: ["wayfinding"] });
  const input = { query: "Remember winding trail", context: "private", intimacyMode: "off",
    recordRecall: false, shadowMode: "off", jevMode: "on", contextBudgetChars: 12000,
    associationRecall: { enabled: true, mode: "on", items: [{ id: "zz:target", seed_id: "seed",
      qualified: true, similarity: .85, threshold: .64, association_rank: 1 }] } };
  const baseline = options => recallMemoriesWithTrace(db, options);
  const snapshot = () => {
    let captured;
    const result = baseline({ ...input, captureCandidates: value => { captured = value; } });
    return buildJevSnapshot(captured, result, input);
  };
  return { db, input, baseline, snapshot };
}

test("crowded multi-source candidates cannot starve a hidden-seed T2 before judging", async t => {
  const { db, input, baseline, snapshot } = fixture(t);
  const ids = Array.from({ length: 30 }, (_, i) => `a:${i}`);
  for (const id of ids) writeMemory(db, { id, title: "Unrelated observations", content: "Detailed engineering measurements. ".repeat(35) });
  input.vectorRecall = { enabled: true, mode: "on", items: ids.map((id, i) => ({ id, rank: i + 1, qualified: true, similarity: .8 })) };
  input.associationRecall.items.push(...ids.map((id, i) => ({ id, seed_id: "seed", qualified: true,
    similarity: .85, threshold: .64, association_rank: i + 2 })));
  const plan = snapshot();
  assert.equal(plan.coverage.association_required_count, 1);
  assert.equal(plan.coverage.association_covered_count, 1);
  assert.ok(plan.rows.some(row => row.candidate.candidate_id === "zz:target"));
  const result = await runSemanticRecall(db, input, baseline, { config: { available: true },
    judge: async plan => ({ decisions: plan.rows.map(({ candidate }) => ({ candidate_id: candidate.candidate_id,
      relevance: candidate.candidate_id === "zz:target" ? "useful" : "irrelevant", use: "supporting",
      priority: 2, path_fit: "coherent", answer_utility: "material" })) }) });
  assert.deepEqual(result.memories.map(row => row.id), ["zz:target"], JSON.stringify({
    coverage: result.trace.semantic_coverage,
    unexpected: result.trace.candidates.filter(row => row.final && row.id !== "zz:target"),
  }));
  assert.equal(result.memories[0].recall_tier, "T2");
});

test("over-budget required paths are explicitly deferred while every scheduled request stays bounded", async t => {
  const { db, input, baseline, snapshot } = fixture(t);
  for (let i = 0; i < 45; i++) {
    const id = `path:${i}`;
    writeMemory(db, { id, title: "Associated event", tags: ["wayfinding"], content: "Additional observations. ".repeat(40) });
    input.associationRecall.items.push({ id, seed_id: "seed", qualified: true, similarity: .8, threshold: .64, association_rank: i + 2 });
  }
  const plan = snapshot();
  assert.equal(plan.batches.length, 3);
  assert.ok(plan.coverage.required_truncated_count > 0);
  for (const batch of plan.batches) assert.ok(JSON.stringify(buildJevRequest(batch.payload)).length <= 12000);
  let status;
  const result = await runSemanticRecall(db, { ...input, onRecallStatus: value => { status = value; } }, baseline, {
    config: { available: true }, judge: async plan => ({ decisions: plan.rows.map(({ candidate }) => ({
      candidate_id: candidate.candidate_id, relevance: "irrelevant", use: "omit", path_fit: "broken", answer_utility: "none" })) }),
  });
  assert.equal(status.jev_status, "partial");
  assert.ok(result.trace.candidates.some(row => row.reason === "association-path-deferred"));
  assert.equal(result.trace.semantic_coverage.required_truncated_count, plan.coverage.required_truncated_count);
});

test("past-event wording retains vector candidates in both recall and the model inspection pool", t => {
  const { input, baseline } = fixture(t);
  for (const query of ["之前那次我们探索的小屋，当时有什么故事？", "那次我们探索的小屋，有什么故事？"]) {
    let captured;
    const result = baseline({ ...input, query, associationRecall: null,
      vectorRecall: { enabled: true, mode: "on", items: [{ id: "zz:target", qualified: true, rank: 1, similarity: .8 }] },
      captureCandidates: value => { captured = value; } });
    assert.ok(result.memories.some(row => row.id === "zz:target"));
    assert.ok(captured.entries.some(row => row.entry.memory.id === "zz:target"));
    assert.equal(result.trace.recall_plan.state_scope, "current");
  }
});

test("wire format deduplicates seeds, keeps local evidence pins and covers every model batch", async t => {
  const { input, snapshot } = fixture(t);
  const plan = snapshot();
  const candidate = plan.payload.candidates.find(row => row.requires_path_judgment);
  const payload = { ...plan.payload, candidates: Array.from({ length: 6 }, (_, i) => ({ ...candidate, candidate_id: `test:${i}` })) };
  const request = buildJevRequest(payload);
  assert.equal(request.state.seeds.length, 1);
  assert.ok(request.state.candidates.every(row => row.association_context.seed_ref === "s0"));
  assert.ok(!JSON.stringify(request).includes(candidate.content_hash));
  const calls = [];
  const result = await judgeJevCandidates(plan, { config: { baseUrl: "https://example.invalid", apiKey: "test", model: "test", timeoutMs: 1000 },
    requireComplete: true, fetchImpl: async (_url, options) => {
      const payload = JSON.parse(options.body);
      calls.push(payload);
      const answers = {};
      for (const [key, question] of Object.entries(payload.questions)) {
        const choice = key.endsWith("_path_fit") ? "coherent" : key.endsWith("_answer_utility") ? "material"
          : key.endsWith("_relevance") ? "useful" : key.endsWith("_priority") ? "2"
          : key.endsWith("_reason_code") ? "topic-support" : "snippet";
        answers[key] = { type: "choice", choice, probabilities: Object.fromEntries(
          Object.keys(question.criteria).map(option => [option, Number(option === choice)])) };
      }
      return Response.json({ answers, model: "test", usage: { input_tokens: 10, output_tokens: 2 } });
    } });
  assert.equal(calls.length, plan.batches.length);
  assert.equal(result.decisions.length, plan.rows.length);
  assert.ok(result.decisions.some(row => row.candidate_id === "zz:target"));
  assert.equal(result.usage.input_tokens, 10 * calls.length);
  assert.ok(result.decisions.every(row => row.support_refs.length === 1));
  assert.equal(input.recordRecall, false);
});

