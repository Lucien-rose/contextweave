import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, writeMemory } from "../src/database.js";
import { recallMemoriesWithTrace } from "../src/recall/sqlite.js";
import { runSemanticRecall } from "../src/recall/semantic-runtime.js";
import { judgeJevCandidates } from "../src/recall/jev-provider.js";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "cw-association-"));
  const { db } = openDatabase(join(directory, "test.sqlite"));
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  writeMemory(db, { id: "demo:seed", title: "Navigation notebook", tags: ["wayfinding"],
    content: "The route follows a winding trail. Ordering refers to relation ranking." });
  writeMemory(db, { id: "demo:target", title: "Shelter inspection", tags: ["wayfinding"],
    content: "A dry cabin stands beside the lake." });
  const input = { query: "Remember winding trail", context: "private", intimacyMode: "off",
    recordRecall: false, shadowMode: "off", jevMode: "on",
    associationRecall: { enabled: true, mode: "on", items: [{ id: "demo:target", seed_id: "demo:seed",
      qualified: true, similarity: .85, threshold: .64, association_rank: 1 }] } };
  const baseline = options => recallMemoriesWithTrace(db, options);
  const run = (judge, overrides = {}) => runSemanticRecall(db, { ...input, ...overrides }, baseline,
    { config: { available: true }, judge });
  return { db, input, baseline, run };
}

function decisions(snapshot, pathFit = "coherent", utility = "material") {
  return { decisions: snapshot.rows.map(({ candidate }) => ({ candidate_id: candidate.candidate_id,
    relevance: candidate.candidate_id === "demo:target" ? "useful" : "irrelevant",
    use: candidate.candidate_id === "demo:target" ? "supporting" : "omit",
    context_fit: "appropriate", priority: 2, path_fit: pathFit, answer_utility: utility })) };
}

test("vague association keeps T2 when its intermediate seed is omitted", async t => {
  const { run } = fixture(t);
  const result = await run(async snapshot => {
    const candidate = snapshot.payload.candidates.find(row => row.candidate_id === "demo:target");
    assert.equal(candidate.requires_path_judgment, true);
    assert.equal(candidate.association_context.seed.id, "demo:seed");
    assert.ok(candidate.association_context.seed.query_evidence.lexical.matches.length);
    assert.equal(candidate.association_context.bridge.cue, "wayfinding");
    assert.ok(snapshot.coverage.selected_chars <= snapshot.coverage.char_budget);
    return decisions(snapshot);
  });
  assert.deepEqual(result.memories.map(row => row.id), ["demo:target"]);
  assert.equal(result.memories[0].recall_tier, "T2");
});

test("incidental lexical overlap cannot be rescued by strong neighbour similarity", async t => {
  const { run } = fixture(t);
  const result = await run(async snapshot => {
    const context = snapshot.payload.candidates.find(row => row.candidate_id === "demo:target").association_context;
    assert.ok(context.seed.query_evidence.lexical.matches.some(match => match.term === "ordering"));
    assert.equal(context.bridge.similarity, .85);
    return decisions(snapshot, "broken");
  }, { query: "Implement ordering for a list of numbers" });
  assert.deepEqual(result.memories, []);
  assert.equal(result.trace.candidates.find(row => row.id === "demo:target").reason, "association-path-broken");
});

test("valid association still needs answer utility and background uses its own budget", async t => {
  const { run } = fixture(t);
  const irrelevant = await run(async snapshot => decisions(snapshot, "coherent", "none"));
  assert.deepEqual(irrelevant.memories, []);
  const background = await run(async snapshot => decisions(snapshot, "coherent", "background"),
    { backgroundLimit: 1, backgroundBudgetChars: 1500 });
  assert.deepEqual(background.memories, []);
  assert.deepEqual(background.background_memories.map(row => row.id), ["demo:target"]);
});

test("provider failure suppresses unjudged T2 while preserving local T0/T1", async t => {
  const { run } = fixture(t);
  const result = await run(async () => { throw new Error("offline"); });
  assert.ok(result.memories.some(row => row.id === "demo:seed"));
  assert.ok(!result.memories.some(row => row.id === "demo:target"));
  assert.equal(result.trace.candidates.find(row => row.id === "demo:target").reason, "association-path-unjudged");
});

test("independent query evidence keeps a candidate in T1 without an association veto", async t => {
  const { run } = fixture(t);
  const result = await run(async snapshot => decisions(snapshot, "broken", "none"), {
    vectorRecall: { enabled: true, mode: "on", items: [{ id: "demo:target", rank: 1,
      qualified: true, similarity: .9 }] },
  });
  assert.equal(result.memories.find(row => row.id === "demo:target")?.recall_tier, "T1");
});

test("a seed revision during judgment invalidates its association decision", async t => {
  const { db, run } = fixture(t);
  let status;
  const result = await run(async snapshot => {
    writeMemory(db, { id: "demo:seed", title: "Revised notebook", content: "The old route was withdrawn." });
    return decisions(snapshot);
  }, { onRecallStatus: value => { status = value; } });
  assert.equal(status.jev_status, "stale-snapshot");
  assert.ok(!result.memories.some(row => row.id === "demo:target"));
});

test("provider contract requests path judgments only for association candidates", async t => {
  const { run } = fixture(t);
  const result = await run(snapshot => judgeJevCandidates(snapshot, {
    config: { baseUrl: "https://example.invalid", model: "test", apiKey: "test", timeoutMs: 1000 },
    requireComplete: true,
    fetchImpl: async (_url, options) => {
      const { state, questions } = JSON.parse(options.body);
      const answers = {};
      state.candidates.forEach((candidate, index) => {
        assert.equal(Boolean(questions[`c${index}_path_fit`]), Boolean(candidate.requires_path_judgment));
      });
      for (const [key, question] of Object.entries(questions)) {
        const choice = key.endsWith("_path_fit") ? "coherent" : key.endsWith("_answer_utility") ? "material"
          : key.endsWith("_relevance") ? "useful" : key.endsWith("_priority") ? "2"
          : key.endsWith("_reason_code") ? "topic-support" : "snippet";
        answers[key] = { type: "choice", choice, probabilities: Object.fromEntries(
          Object.keys(question.criteria).map(option => [option, Number(option === choice)])) };
      }
      return Response.json({ answers, model: "test", usage: { input_tokens: 1, output_tokens: 1 } });
    },
  }));
  assert.equal(result.memories.find(row => row.id === "demo:target")?.recall_tier, "T2");
});
