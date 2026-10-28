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
import { prepareQueryContext } from "../src/recall/query-representation.js";

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
  assert.equal(plan.coverage.required_count, plan.coverage.baseline_selected_count + 1);
  assert.equal(plan.batches.length, 1);
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

test("event time and revision lifecycle are independent; explicit raw version intent wins", () => {
  const query = "之前那个顺藤摸瓜找到其他记忆的功能，当时有哪些边界？";
  const past = prepareQueryContext(query, { temporal: { state_scope: "historical" } });
  assert.deepEqual(past.recallPlan.candidate_statuses, ["active", "superseded"]);
  assert.equal(past.recallPlan.state_scope, "current");
  assert.equal(past.recallPlan.historical_intent, false);
  const old = prepareQueryContext(query, { temporal: { state_scope: "historical", version_scope: "superseded" } });
  assert.deepEqual(old.recallPlan.candidate_statuses, ["superseded"]);
  const explicit = prepareQueryContext("旧版本的方案是什么？", { temporal: { state_scope: "current", version_scope: "active" } });
  assert.deepEqual(explicit.recallPlan.candidate_statuses, ["superseded"]);
});

test("low-probability winners abstain independently for relevance, path and utility", async () => {
  const candidate = { candidate_id: "target", title: "Associated event", allowed_uses: ["supporting", "background", "omit"],
    requires_path_judgment: true, association_context: { seed: { id: "seed", title: "Trail", snippet: "Winding route" }, bridge: { cue: "route" } },
    snippet: { id: "pinned", text: "A cabin beside the lake" } };
  const payload = { query: "Remember the winding trail", candidates: [candidate] };
  const request = buildJevRequest(payload);
  assert.equal(Object.keys(request.questions).length, 3);
  assert.match(request.questions.c0_path_fit.criteria.coherent, /requested operation and property/);
  for (const weak of [null, "relevance", "path_fit", "answer_utility"]) {
    const result = await judgeJevCandidates({ payload }, {
      config: { baseUrl: "https://example.invalid", apiKey: "test", model: "test", timeoutMs: 1000 },
      fetchImpl: async () => {
        const answers = Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
          const choice = key.endsWith("path_fit") ? "coherent" : key.endsWith("relevance") ? "useful" : "material";
          const options = Object.keys(question.criteria);
          const probability = key === `c0_${weak}` ? .6 : 1;
          return [key, { type: "choice", choice, probabilities: Object.fromEntries(options.map(option =>
            [option, option === choice ? probability : (1 - probability) / (options.length - 1)])) }];
        }));
        return Response.json({ answers, model: "test", usage: { input_tokens: 1, output_tokens: 1 } });
      },
    });
    const decision = result.decisions[0];
    if (weak === "path_fit") assert.equal(decision.path_fit, "uncertain");
    else assert.equal(decision.use, weak ? "omit" : "supporting");
    assert.deepEqual(decision.support_refs, weak && weak !== "path_fit" ? [] : ["pinned"]);
  }
});

test("calibrated admission keeps useful evidence at 0.75 while association paths require 0.8", async () => {
  const candidate = { candidate_id: "target", title: "Associated event", allowed_uses: ["supporting", "background", "omit"],
    requires_path_judgment: true, association_context: { seed: { id: "seed", title: "Trail", snippet: "Winding route" }, bridge: { cue: "route" } },
    snippet: { id: "pinned", text: "A cabin beside the lake" } };
  const payload = { query: "Remember the winding trail", candidates: [candidate] };
  const request = buildJevRequest(payload);
  const judge = async probabilities => judgeJevCandidates({ payload }, {
    config: { baseUrl: "https://example.invalid", apiKey: "test", model: "test", timeoutMs: 1000 },
    fetchImpl: async () => Response.json({ answers: Object.fromEntries(
      Object.entries(request.questions).map(([key, question]) => {
        const field = key.slice(3);
        const choice = field === "path_fit" ? "coherent" : field === "relevance" ? "useful" : "material";
        const probability = probabilities[field];
        const options = Object.keys(question.criteria);
        return [key, { type: "choice", choice, probabilities: Object.fromEntries(options.map(option =>
          [option, option === choice ? probability : (1 - probability) / (options.length - 1)])) }];
      })), model: "test", usage: { input_tokens: 1, output_tokens: 1 } }),
  });
  const admitted = (await judge({ relevance: .76, path_fit: .8, answer_utility: .75 })).decisions[0];
  assert.equal(admitted.use, "supporting");
  assert.equal(admitted.path_fit, "coherent");
  const weakPath = (await judge({ relevance: .76, path_fit: .79, answer_utility: .75 })).decisions[0];
  assert.equal(weakPath.use, "supporting");
  assert.equal(weakPath.path_fit, "uncertain");
  const weakRelevance = (await judge({ relevance: .74, path_fit: .8, answer_utility: .75 })).decisions[0];
  assert.equal(weakRelevance.use, "omit");
});

test("direct identity stays protected while answer utility controls its use for this question", t => {
  const { baseline } = fixture(t);
  const recall = answerUtility => baseline({
    query: "Navigation notebook", context: "private", intimacyMode: "off",
    allowRepeat: true, recordRecall: false, shadowMode: "off",
    semanticDecisions: new Map([["seed", {
      relevance: "useful", use: answerUtility === "none" ? "omit" : "supporting",
      context_fit: "appropriate", priority: 2, answer_utility: answerUtility,
    }]]),
  });
  const material = recall("material");
  assert.equal(material.memories[0]?.id, "seed");
  assert.equal(material.memories[0]?.recall_tier, "T0");

  const background = recall("background");
  assert.deepEqual(background.memories, []);
  assert.equal(background.background_memories[0]?.id, "seed");

  const unsupported = recall("none");
  assert.deepEqual(unsupported.memories, []);
  const trace = unsupported.trace.candidates.find(row => row.id === "seed");
  assert.equal(trace.reason, "direct-no-answer-utility");
  assert.deepEqual(trace.direct_answer_judgment, { answer_utility: "none" });

  const uncertain = recall("uncertain");
  assert.equal(uncertain.memories[0]?.id, "seed");
  assert.equal(uncertain.memories[0]?.recall_tier, "T0");
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
      queryRepresentation: { temporal: { state_scope: "historical" } },
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
