import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { openDatabase, writeMemory, getMemory } from '../server/src/database.js';
import { progressiveRecall } from '../server/src/recall/sqlite.js';

// No provider calls, production database, environment credentials or recall writes.
const root = new URL('../', import.meta.url);
const fixtureText = readFileSync(new URL('evaluation/pilot.json', root), 'utf8');
const fixture = JSON.parse(fixtureText);
const k = 5, repetitions = 10;
const { db } = openDatabase(':memory:');
const ids = new Set(fixture.memories.map(m => m.id));
assert.equal(ids.size, fixture.memories.length);
for (const q of fixture.questions) for (const id of q.relevant) assert.ok(ids.has(id));
for (const m of fixture.memories) writeMemory(db, {
  sensitivity: 'personal', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', ...m,
});
const stopwords = new Set('what which who is are the a an of to does do did and in on for how should be with her his now current'.split(' '));
function fts(q) {
  const tokens = [...new Set((q.query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(t => !stopwords.has(t)))];
  if (!tokens.length) return [];
  const expression = tokens.map(t => `"${t}"`).join(' OR ');
  return db.prepare(`SELECT f.memory_id AS id FROM memories_fts f JOIN memories m ON m.id=f.memory_id
    WHERE memories_fts MATCH ? AND m.status='active' ORDER BY bm25(memories_fts,0,3,1,2,2),f.memory_id LIMIT ?`)
    .all(expression, k).map(r => r.id);
}
async function local(q) {
  const r = await progressiveRecall(db, { query: q.query, context: 'private', intimacyMode: 'off',
    limit: k, backgroundLimit: 0, recordRecall: false, syncIndex: false, vectorMode: 'off', jevMode: 'off',
    includeArchived: true, allowedMemoryIds: fixture.memories.filter(m => !m.status || m.status === 'active').map(m => m.id),
    at: new Date('2026-10-27T00:00:00Z') });
  return r.memories.map(m => m.id).slice(0, k);
}
function score(expected, actual) {
  const hits = actual.filter(id => expected.includes(id)).length;
  return { hits, expected: expected.length, returned: actual.length,
    top1_hit: expected.length ? Number(expected.includes(actual[0])) : null,
    reciprocal_rank: expected.length ? (actual.findIndex(id => expected.includes(id)) < 0 ? 0 : 1/(actual.findIndex(id => expected.includes(id))+1)) : null,
    precision: actual.length ? hits / actual.length : null,
    recall: expected.length ? hits / expected.length : null,
    false_positive: actual.some(id => !expected.includes(id)),
    abstention_correct: expected.length ? null : actual.length === 0 };
}
assert.deepEqual(score(['a','b'], ['a','c']), { hits:1,expected:2,returned:2,top1_hit:1,reciprocal_rank:1,precision:0.5,recall:0.5,false_positive:true,abstention_correct:null });
assert.equal(score([], []).abstention_correct, true);
assert.equal(score(['a'], []).recall, 0);
const quantile = (xs,p) => [...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1];
const mean = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const summarize = rows => ({ questions: rows.length,
  top1_hit_rate: mean(rows.filter(r=>r.top1_hit!==null).map(r=>r.top1_hit)),
  mrr_at_5: mean(rows.filter(r=>r.reciprocal_rank!==null).map(r=>r.reciprocal_rank)),
  precision_micro: rows.reduce((s,r)=>s+r.hits,0)/Math.max(1,rows.reduce((s,r)=>s+r.returned,0)),
  recall_macro_answerable: mean(rows.filter(r=>r.recall!==null).map(r=>r.recall)),
  abstention_accuracy: mean(rows.filter(r=>r.abstention_correct!==null).map(r=>Number(r.abstention_correct))),
  false_positive_query_rate: mean(rows.map(r=>Number(r.false_positive))),
  mean_returned_chars: mean(rows.map(r=>r.context_chars)),
  latency_p50_ms: quantile(rows.flatMap(r=>r.latencies_ms),0.5),
  latency_p95_ms: quantile(rows.flatMap(r=>r.latencies_ms),0.95) });
const results = {};
const before = db.prepare('SELECT id,content_hash,recall_count,last_recalled_at FROM memories ORDER BY id').all();
try {
  for (const [name, run] of [['sqlite-fts5-bm25',fts],['contextweave-local',local]]) {
    const rows = [];
    for (const q of fixture.questions) {
      const actual = await run(q); // untimed warm-up
      assert.equal(new Set(actual).size,actual.length);
      assert.ok(actual.every(id=>getMemory(db,id).status==='active'));
      const latencies = [];
      for (let n=0;n<repetitions;n++) {
        const start = performance.now();
        const repeat = await run(q);
        latencies.push(performance.now()-start);
        assert.deepEqual(repeat, actual, `${name}/${q.id} changed across repetitions`);
      }
      rows.push({ ...q, actual, ...score(q.relevant, actual),
        context_chars: actual.reduce((s,id)=> { const m=getMemory(db,id); return s+m.title.length+m.content.length; },0), latencies_ms: latencies });
    }
    results[name] = { summary: summarize(rows),
      by_language: Object.fromEntries(['en','zh'].map(lang=>[lang,summarize(rows.filter(r=>r.id.startsWith(lang)))])), rows };
  }
  assert.deepEqual(db.prepare('SELECT id,content_hash,recall_count,last_recalled_at FROM memories ORDER BY id').all(),before);
} finally { db.close(); }
const report = {
  label: 'Local retrieval diagnostic only; not a ContextWeave product-effect benchmark, not held-out, not LongMemEval, and not end-to-end answer accuracy',
  created_at: new Date().toISOString(), commit: execFileSync('git',['rev-parse','HEAD'], {cwd:root,encoding:'utf8'}).trim(),
  dataset_sha256: createHash('sha256').update(fixtureText).digest('hex'), node: process.version,
  k, repetitions, memories: fixture.memories.length, provider_calls:0, provider_cost_usd:0,
  methodology: ['Canonical records supplied; ingestion not evaluated.', 'Same active corpus, k and queries; no query hints.',
    'FTS baseline: unicode61, OR tokens, fixed English stopwords, BM25 weights 0/3/1/2/2.',
    'Chinese segmentation differs between baseline and ContextWeave; language breakdown provided.',
    'Latency is warm in-process retrieval only, not network or LLM latency.',
    'Characters count returned title+body, not exact tokens or full serialized response.',
    'Unanswerable means no answer-bearing record; topic-adjacent retrieval counts as false positive under this strict rubric.',
    'No policy tests against unfiltered FTS; private context is shared by both groups.',
    'Ten timing repeats do not increase the number of independent questions.',
    'Both groups receive active IDs only; update-current cases do not evaluate lifecycle write correctness or historical retrieval.',
    'Dataset has only 22 memories and 28 questions (20 answerable, 8 unanswerable); no statistical superiority claim.',
    'Metrics, deterministic output, active-only membership and absence of recall-state writes are asserted.'],
  unavailable: ['vector-only: no local embedding credentials or vector service configured',
    'hybrid: same missing connections', 'full semantic pipeline: no local model credentials configured'], results,
};
const directory = new URL('evaluation/results/',root);
mkdirSync(directory,{recursive:true});
writeFileSync(new URL('pilot.json',directory),JSON.stringify(report,null,2)+'\n');
const pct = x=>x===null?'N/A':(x*100).toFixed(1)+'%';
const lines = ['# Local retrieval diagnostic','',report.label,'',`Commit: ${report.commit}`,`Dataset: ${report.dataset_sha256}`,'',
  '| Group | Precision (micro) | Recall (answerable macro) | Correct abstention | Queries with false positives | Mean chars | p50 ms | p95 ms |',
  '|---|---:|---:|---:|---:|---:|---:|---:|'];
for (const [name,{summary:s}] of Object.entries(results)) lines.push(`| ${name} | ${pct(s.precision_micro)} | ${pct(s.recall_macro_answerable)} | ${pct(s.abstention_accuracy)} | ${pct(s.false_positive_query_rate)} | ${s.mean_returned_chars.toFixed(1)} | ${s.latency_p50_ms.toFixed(2)} | ${s.latency_p95_ms.toFixed(2)} |`);
lines.push('', '## Ranking and language breakdown','', '| Group / language | Questions | Top-1 hit (answerable) | MRR@5 | Recall@5 (answerable) | Correct abstention |', '|---|---:|---:|---:|---:|---:|');
for(const [name,r] of Object.entries(results)) for(const [lang,s] of Object.entries({all:r.summary,...r.by_language})) lines.push(`| ${name} / ${lang} | ${s.questions} | ${pct(s.top1_hit_rate)} | ${s.mrr_at_5.toFixed(3)} | ${pct(s.recall_macro_answerable)} | ${pct(s.abstention_accuracy)} |`);
lines.push('', '## Limits','',...report.methodology.map(s=>'- '+s),'','## Not run','',...report.unavailable.map(s=>'- '+s),'','## Per-question results','',
  '| Question | Category | Expected | FTS | Local |','|---|---|---|---|---|');
for (let i=0;i<fixture.questions.length;i++) { const q=fixture.questions[i];lines.push(`| ${q.id}: ${q.query} | ${q.category} | ${q.relevant.join(', ')} | ${results['sqlite-fts5-bm25'].rows[i].actual.join(', ')} | ${results['contextweave-local'].rows[i].actual.join(', ')} |`); }
writeFileSync(new URL('pilot.md',directory),lines.join('\n')+'\n');
console.log(JSON.stringify({results:Object.fromEntries(Object.entries(results).map(([n,r])=>[n,r.summary])), provider_calls:0, report:fileURLToPath(new URL('pilot.md',directory))},null,2));
