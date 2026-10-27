import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../server/src/database.js';
import { createMemoryCore } from '../server/src/memory-core.js';
import { createRecallRepository } from '../server/src/recall/sqlite.js';
import { progressiveRecall } from '../server/src/recall/progressive.js';
import { runSemanticRecall } from '../server/src/recall/semantic-runtime.js';
import { setDelegationPolicy } from '../server/src/evolution/policy.js';
import { saveEntity, linkEntity } from '../server/src/entity/service.js';
import { prepareVectorRecall, prepareAssociativeVectorRecall, syncVectorIndex, vectorRuntimeStatus } from '../server/src/vector-retrieval.js';
import { qdrantConfig } from '../server/src/vector-store.js';
import { vectorIndexIdentity } from '../server/src/vector/identity.js';
import { createEmbeddings, vectorProviderConfig } from '../server/src/vector-provider.js';

const root = new URL('../', import.meta.url);
const k = 5;
const realProviders = process.env.CW_BENCHMARK_REAL_PROVIDERS === '1';
const embeddingRetryDelaysMs = [400, 1200, 3000];
const progress = message => console.error(`[benchmark] ${message}`);

async function benchmarkEmbeddings(texts, options = {}) {
  const vectors = [];
  // Keep the benchmark on the same conservative request shape as interactive
  // recall. Some OpenAI-compatible gateways accept one input but terminate
  // larger request bodies with a transport-level 502.
  for (const text of texts) {
    let lastError;
    for (let attempt = 0; attempt <= embeddingRetryDelaysMs.length; attempt += 1) {
      try {
        const [vector] = await createEmbeddings([text], options);
        vectors.push(vector);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (error?.code !== 'request-failed' || attempt === embeddingRetryDelaysMs.length) throw error;
        await new Promise(resolve => setTimeout(resolve, embeddingRetryDelaysMs[attempt]));
      }
    }
    if (lastError) throw lastError;
  }
  return vectors;
}
const people = [
  ['Mira','espresso','jasmine tea','caffeine disrupted sleep','peanuts','Kyoto','river','station','quiet holidays with at most two activities'],
  ['Nora','latte','chamomile tea','milk upset her stomach','shellfish','Oslo','harbor','library','museum mornings and free afternoons'],
  ['Tariq','cola','sparkling water','sugar caused headaches','sesame','Lima','plaza','museum','one planned activity per day'],
  ['Elena','cocoa','oolong tea','sweet drinks disturbed sleep','almonds','Porto','garden','bridge','slow walks and no early departures'],
  ['Jonas','energy drinks','rooibos tea','caffeine caused palpitations','soy','Tallinn','old town','market','small hotels away from nightlife'],
  ['Priya','lemon soda','plain water','acid irritated her throat','cashews','Jaipur','palace','observatory','food markets before noon'],
  ['Camille','mocha','mint tea','coffee worsened anxiety','mustard','Lyon','riverside','opera','train travel instead of flights'],
  ['Soren','black coffee','barley tea','coffee caused reflux','eggs','Aarhus','canal','university','rainy coastal walks'],
];
const projects = [
  ['Cobalt','2026-10-01','2026-11-12','staged regional rollout','Inez'],
  ['Orion','2026-09-18','2026-12-03','single canary region','Malik'],
  ['Juniper','2026-08-11','2027-01-16','blue-green deployment','Rosa'],
  ['Harbor','2026-07-22','2027-02-05','two-wave customer migration','Dev'],
  ['Kestrel','2026-06-09','2027-03-19','dark launch before general release','Aya'],
  ['Lantern','2026-05-14','2027-04-02','feature flags by tenant','Noah'],
];

const events = [];
const questions = [];
const labelToId = new Map();
function event(label, family, kind, title, content, extra = {}) {
  events.push({ label, family, candidate_kind: kind, title, content, ...extra });
}
function question(id, split, category, query, labels = []) {
  questions.push({ id, split, category, query, labels });
}
for (let i=0;i<people.length;i++) {
  const [name,oldDrink,drink,reason,allergy,city,may,june,travel] = people[i];
  const split = i < 2 ? 'dev' : 'heldout';
  event(`${name}:drink:old`,`${name}:drink`,'preference',`${name} beverage preference`,`${name} prefers ${oldDrink}.`,{tags:[name,'beverage'],triggers:[name,oldDrink]});
  event(`${name}:drink`,`${name}:drink`,'correction',`${name} current beverage preference`,`${name} now prefers ${drink}.`,{base_label:`${name}:drink:old`,tags:[name,'beverage'],triggers:[name,drink]});
  event(`${name}:reason`,`${name}:reason`,'preference',`${name} beverage change reason`,`${name} stopped drinking ${oldDrink} because ${reason}.`,{tags:[name,'beverage'],triggers:[name,oldDrink]});
  event(`${name}:allergy`,`${name}:allergy`,'preference',`${name} food allergy`,`${name} is allergic to ${allergy}.`,{tags:[name,'allergy'],triggers:[name,allergy]});
  event(`${name}:may`,`${name}:trips`,'daily-event',`${name} May ${city} visit`,`${name} visited ${city} in May and stayed near the ${may}.`,{event_date:'2026-05-14',tags:[name,city,'May'],triggers:[name,city,may]});
  event(`${name}:june`,`${name}:trips`,'daily-event',`${name} June ${city} visit`,`${name} visited ${city} in June and stayed near the ${june}.`,{event_date:'2026-06-18',tags:[name,city,'June'],triggers:[name,city,june]});
  event(`${name}:travel`,`${name}:travel`,'preference',`${name} travel preference`,`${name} prefers ${travel}.`,{tags:[name,'travel'],triggers:[name,'travel']});
  question(`${name}-01`,split,'current',`What is ${name}'s current beverage preference?`,[`${name}:drink`]);
  question(`${name}-02`,split,'paraphrase',`What does ${name} like to drink now?`,[`${name}:drink`]);
  question(`${name}-03`,split,'reason',`Why did ${name} stop drinking ${oldDrink}?`,[`${name}:reason`]);
  question(`${name}-04`,split,'history',`What drink did ${name} prefer before the change?`,[`${name}:drink:old`]);
  question(`${name}-05`,split,'direct',`What food is ${name} allergic to?`,[`${name}:allergy`]);
  question(`${name}-06`,split,'paraphrase',`Which ingredient must ${name} avoid eating?`,[`${name}:allergy`]);
  question(`${name}-07`,split,'temporal',`Where did ${name} stay during the May ${city} visit?`,[`${name}:may`]);
  question(`${name}-08`,split,'temporal',`Where did ${name} stay during the June ${city} visit?`,[`${name}:june`]);
  question(`${name}-09`,split,'multi-record',`What does ${name} drink now, and why was ${oldDrink} abandoned?`,[`${name}:drink`,`${name}:reason`]);
  question(`${name}-10`,split,'preference',`How should ${name}'s holidays be planned?`,[`${name}:travel`]);
  question(`${name}-u1`,split,'unanswerable',`What is ${name}'s favorite telescope brand?`,[]);
  question(`${name}-u2`,split,'unanswerable',`What is the name of ${name}'s sibling?`,[]);
}
for (let i=0;i<projects.length;i++) {
  const [name,oldDate,date,deployment,owner] = projects[i];
  const split = i < 2 ? 'dev' : 'heldout';
  event(`${name}:date:old`,`${name}:date`,'project-milestone',`${name} release date`,`${name} launches on ${oldDate}.`,{tags:[name,'release'],triggers:[name,oldDate]});
  event(`${name}:date`,`${name}:date`,'correction',`${name} current release date`,`${name} now launches on ${date}.`,{base_label:`${name}:date:old`,tags:[name,'release'],triggers:[name,date]});
  event(`${name}:deployment`,`${name}:deployment`,'project-milestone',`${name} deployment decision`,`${name} uses a ${deployment}.`,{tags:[name,'deployment'],triggers:[name,'deployment']});
  event(`${name}:owner`,`${name}:owner`,'preference',`${name} project owner`,`${owner} owns the ${name} project.`,{tags:[name,'owner'],triggers:[name,owner]});
  question(`${name}-01`,split,'current',`When is the current ${name} launch?`,[`${name}:date`]);
  question(`${name}-02`,split,'history',`What was the previous ${name} launch date?`,[`${name}:date:old`]);
  question(`${name}-03`,split,'direct',`What deployment approach does ${name} use?`,[`${name}:deployment`]);
  question(`${name}-04`,split,'direct',`Who owns the ${name} project?`,[`${name}:owner`]);
  question(`${name}-u1`,split,'unanswerable',`What color is the ${name} project logo?`,[]);
}
for (const [n,query] of [
  ['unrelated-01','How thick is the crust of Mars?'],['unrelated-02','Medieval pottery glazing methods'],
  ['unrelated-03','Volcanic seismic resonance'],['unrelated-04','How do whales navigate oceans?'],
  ['unrelated-05','Baroque counterpoint exercises'],['unrelated-06','What causes aurora on Jupiter?'],
  ['unrelated-07','How are coral reefs formed?'],['unrelated-08','Who painted the ceiling of the Sistine Chapel?'],
  ['unrelated-09','What is the boiling point of liquid nitrogen?'],['unrelated-10','How do migratory birds sense magnetic fields?'],
  ['unrelated-11','Explain the grammar of Classical Latin.'],['unrelated-12','What causes tides on Europa?'],
  ['unrelated-13','How does sourdough fermentation work?'],['unrelated-14','What is the history of movable type?'],
  ['unrelated-15','How do desert plants conserve water?'],['unrelated-16','Describe the rings of Saturn.'],
]) question(n, /-(?:01|02)$/.test(n) ? 'dev' : 'heldout', 'unrelated', query, []);

const { db } = openDatabase(':memory:');
const core = createMemoryCore(db);
setDelegationPolicy(db,{enabled:true,confirmation:true});
for (let i=0;i<events.length;i++) {
  const e = events[i];
  const base = e.base_label ? labelToId.get(e.base_label) : null;
  assert.ok(!e.base_label || base, `Missing base ${e.base_label}`);
  const outcome = await core.ingestCandidateWithFamily({
    candidate_kind:e.candidate_kind, title:e.title, content:e.content, base_memory_id:base,
    event_date:e.event_date, tags:e.tags, triggers:e.triggers, sensitivity:'personal', mentionability:'contextual',
    importance:70, confidence:0.99, meaning_score:0.95,
    source_refs:[{source_type:'conversation',source_id:`synthetic-event-${String(i+1).padStart(3,'0')}`,excerpt:e.content}],
  });
  assert.equal(outcome.candidate.policy_decision,'auto-save');
  assert.ok(outcome.memory, `Event did not become a memory: ${e.label}`);
  labelToId.set(e.label,outcome.memory.id);
}
for (const q of questions) q.relevant = q.labels.map(label => {
  assert.ok(labelToId.has(label),`Unknown expected label ${label}`); return labelToId.get(label);
});
for (const [name] of [...people,...projects]) {
  const { entity }=saveEntity(db,{type:projects.some(([project])=>project===name)?'project':'person',display_name:name,aliases:[],sensitivity:'private',namespace:'real'});
  for(const [label,memoryId] of labelToId) if(label.startsWith(`${name}:`)) linkEntity(db,{entity_id:entity.id,memory_id:memoryId,linked:true});
}
progress(`fixture ready: ${events.length} events, ${questions.filter(q=>q.split==='heldout').length} held-out questions`);

let providerStatus = null;
let testVectorStore = null;
if(realProviders) {
  const provider=vectorProviderConfig();
  assert.ok(provider.available,'Configured embedding provider is unavailable');
  testVectorStore=qdrantConfig({indexIdentity:vectorIndexIdentity(provider),dimensions:provider.dimensions});
  assert.match(testVectorStore.collection,/^cw_eval_[a-z0-9_]*_[a-f0-9]{16}$/,'Refusing to use a non-benchmark Qdrant collection');
  progress(`provider preflight: ${provider.model} (${provider.dimensions} dimensions)`);
  await benchmarkEmbeddings(['ContextWeave benchmark connectivity probe'],{config:provider});
  progress('provider preflight passed; building isolated vector index');
  await syncVectorIndex(db,{embedder:benchmarkEmbeddings,batchSize:4,maxBatches:100});
  providerStatus=await vectorRuntimeStatus(db,{probe:true});
  assert.equal(providerStatus.qdrant?.reachable,true,'Benchmark Qdrant collection is unreachable');
  assert.equal(providerStatus.pending_count,0,'Benchmark vectors are not fully indexed');
  progress(`vector index ready: ${providerStatus.indexed_count}/${providerStatus.eligible_count} memories`);
}

const all = core.list({status:'all',limit:1000});
const documents = all.map(m => ({id:m.id,status:m.status,text:`${m.title} ${m.content} ${(m.tags||[]).join(' ')}`}));
const tokenized = documents.map(d => features(d.text));
const df = new Map();
for (const tokens of tokenized) for (const token of new Set(tokens)) df.set(token,(df.get(token)||0)+1);
const idf = token => Math.log((documents.length+1)/((df.get(token)||0)+1))+1;
const docVectors = new Map(documents.map((d,i)=>[d.id,vector(tokenized[i])]));
function features(text) {
  const clean = text.toLowerCase().normalize('NFKC');
  const words = clean.match(/[\p{L}\p{N}]+/gu) || [];
  const compact = clean.replace(/[^\p{L}\p{N}]+/gu,'');
  const chars = [];
  for(let n=2;n<=4;n++) for(let i=0;i<=compact.length-n;i++) chars.push(`#${compact.slice(i,i+n)}`);
  return [...words,...chars];
}
function vector(tokens) {
  const counts = new Map();
  for(const token of tokens) counts.set(token,(counts.get(token)||0)+1);
  const out = new Map(); let norm=0;
  for(const [token,count] of counts) { const value=(1+Math.log(count))*idf(token);out.set(token,value);norm+=value*value; }
  norm=Math.sqrt(norm)||1; for(const [token,value] of out) out.set(token,value/norm); return out;
}
function cosine(a,b) { let score=0; const [small,large]=a.size<b.size?[a,b]:[b,a];for(const [t,v] of small) score+=v*(large.get(t)||0);return score; }
function historical(query) { return /\b(previous|before|former|old|used to|historical)\b/i.test(query); }
function eligible(q) { return documents.filter(d => d.status==='active' || historical(q.query)); }
function vectorRank(q, threshold) {
  const qv=vector(features(q.query));
  return eligible(q).map(d=>({id:d.id,score:cosine(qv,docVectors.get(d.id))})).filter(x=>x.score>=threshold)
    .sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,k);
}
const stopwords = new Set('what which who is are the a an of to does do did and in on for how should be with her his now current name during was before change'.split(' '));
function ftsRank(q) {
  const tokens=[...new Set((q.query.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).filter(t=>!stopwords.has(t)))];
  if(!tokens.length)return [];
  const expression=tokens.map(t=>`"${t}"`).join(' OR ');
  const statuses=historical(q.query)?['active','superseded']:['active'];
  const placeholders=statuses.map(()=>'?').join(',');
  return db.prepare(`SELECT f.memory_id id,-bm25(memories_fts,0,3,1,2,2) score FROM memories_fts f JOIN memories m ON m.id=f.memory_id WHERE memories_fts MATCH ? AND m.status IN (${placeholders}) ORDER BY bm25(memories_fts,0,3,1,2,2),f.memory_id LIMIT ?`)
    .all(expression,...statuses,k);
}
function hybridRank(q,threshold) {
  const ranks=new Map();
  for(const [list,weight] of [[ftsRank(q),1],[vectorRank(q,threshold),1]]) list.forEach((x,i)=>ranks.set(x.id,(ranks.get(x.id)||0)+weight/(60+i+1)));
  return [...ranks].map(([id,score])=>({id,score})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,k);
}
function score(expected,actual) {
  const hits=actual.filter(id=>expected.includes(id)).length;
  const rank=actual.findIndex(id=>expected.includes(id));
  return {hits,returned:actual.length,top1:expected.length?Number(expected.includes(actual[0])):null,mrr:expected.length?(rank<0?0:1/(rank+1)):null,precision:actual.length?hits/actual.length:null,recall:expected.length?hits/expected.length:null,false_positive:actual.some(id=>!expected.includes(id)),abstention_correct:expected.length?null:actual.length===0};
}
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
function tuneThreshold() {
  const dev=questions.filter(q=>q.split==='dev');
  let best={threshold:0,score:-Infinity};
  for(let t=0.05;t<=0.5;t+=0.01) {
    const rows=dev.map(q=>score(q.relevant,vectorRank(q,t).map(x=>x.id)));
    const s=mean(rows.map(r=>r.recall??Number(r.abstention_correct)))-mean(rows.map(r=>Number(r.false_positive)))*0.35;
    if(s>best.score)best={threshold:Number(t.toFixed(2)),score:s};
  }
  return best.threshold;
}
const vectorThreshold=realProviders?null:tuneThreshold();
const activeIds=all.filter(m=>m.status==='active').map(m=>m.id);
const localVectors={
  primary:async({query})=>({enabled:true,degraded:false,mode:'on',backend:'offline-tfidf',items:vectorRank({query},vectorThreshold).map((x,i)=>({id:x.id,rank:i+1,similarity:x.score,qualified:true})),query_count:1,candidate_count:documents.length,qualified_count:k,indexed_count:documents.length,eligible_count:documents.length,pending_count:0,indexed_now:0}),
  association:async()=>({enabled:true,degraded:false,mode:'on',items:[],query_count:0,candidate_count:0,qualified_count:0}),
};
const realVectorCache=new Map();
async function realPrimary(options) {
  const key=JSON.stringify([options.query,options.allowedMemoryIds||null]);
  if(!realVectorCache.has(key)) realVectorCache.set(key,prepareVectorRecall(db,{...options,mode:'on',syncIndex:false,ensureStore:false,embedder:benchmarkEmbeddings}));
  const result=await realVectorCache.get(key);
  assert.equal(result.enabled,true,`Real vector route unavailable: ${result.reason||'unknown'}`);
  assert.equal(result.degraded,false,`Real vector route degraded: ${result.reason||'unknown'}`);
  return result;
}
const realVectors={
  primary:realPrimary,
  association:options=>prepareAssociativeVectorRecall(db,{...options,mode:'on',embedder:benchmarkEmbeddings}),
};
const jevStatuses=[];
async function contextweave(q) {
  const history=historical(q.query);
  const options={query:q.query,context:'private',intimacyMode:'off',limit:k,backgroundLimit:0,recordRecall:false,syncIndex:false,vectorMode:'on',jevMode:realProviders?'on':'off',includeArchived:true,allowedMemoryIds:history?null:activeIds,queryRepresentation:{temporal:{state_scope:history?'historical':'current'},task_intent:'memory retrieval'},at:new Date('2026-10-27T00:00:00Z'),onRecallStatus:status=>jevStatuses.push({question_id:q.id,...status})};
  const repository=createRecallRepository(db);
  const result=realProviders
    ? await runSemanticRecall(db,options,input=>progressiveRecall(repository,input,realVectors))
    : await progressiveRecall(repository,options,localVectors);
  return result.memories.map(m=>m.id).slice(0,k);
}
function summarize(rows) { return {questions:rows.length,answerable:rows.filter(r=>r.recall!==null).length,unanswerable:rows.filter(r=>r.abstention_correct!==null).length,top1_hit_rate:mean(rows.filter(r=>r.top1!==null).map(r=>r.top1)),mrr_at_5:mean(rows.filter(r=>r.mrr!==null).map(r=>r.mrr)),precision_micro:rows.reduce((s,r)=>s+r.hits,0)/Math.max(1,rows.reduce((s,r)=>s+r.returned,0)),recall_macro_answerable:mean(rows.filter(r=>r.recall!==null).map(r=>r.recall)),abstention_accuracy:mean(rows.filter(r=>r.abstention_correct!==null).map(r=>Number(r.abstention_correct))),false_positive_query_rate:mean(rows.map(r=>Number(r.false_positive)))}; }
async function selectedVectors(q) {
  if(!realProviders)return vectorRank(q,vectorThreshold);
  const result=await realPrimary({query:q.query,allowedMemoryIds:eligible(q).map(item=>item.id)});
  return result.items.filter(item=>item.qualified).slice(0,k).map(item=>({id:item.id,score:item.similarity}));
}
async function selectedHybrid(q) {
  if(!realProviders)return hybridRank(q,vectorThreshold);
  const ranks=new Map();
  for(const list of [ftsRank(q),await selectedVectors(q)])list.forEach((x,i)=>ranks.set(x.id,(ranks.get(x.id)||0)+1/(60+i+1)));
  return [...ranks].map(([id,score])=>({id,score})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,k);
}
const systems={
  'sqlite-fts5-bm25':async q=>ftsRank(q).map(x=>x.id),
  [realProviders?'neural-vector-only':'tfidf-vector-only']:async q=>(await selectedVectors(q)).map(x=>x.id),
  [realProviders?'fts+neural-hybrid':'fts+tfidf-hybrid']:async q=>(await selectedHybrid(q)).map(x=>x.id),
  [realProviders?'contextweave-full-provider':'contextweave-core-local']:contextweave,
};
const results={};
for(const [name,run] of Object.entries(systems)) {
  const rows=[];
  const heldout=questions.filter(q=>q.split==='heldout');
  progress(`${name}: 0/${heldout.length}`);
  for(const [index,q] of heldout.entries()) {
    const started=performance.now();const actual=await run(q);rows.push({...q,actual,latency_ms:performance.now()-started,...score(q.relevant,actual)});
    if((index+1)%10===0 || index+1===heldout.length) progress(`${name}: ${index+1}/${heldout.length}`);
  }
  results[name]={summary:summarize(rows),by_category:Object.fromEntries([...new Set(rows.map(r=>r.category))].sort().map(c=>[c,summarize(rows.filter(r=>r.category===c))])),rows};
}
const stableDataset={people,projects,events:events.map(({base_label,...e})=>e),questions:questions.map(({relevant,...q})=>q)};
const report={label:realProviders?'Isolated held-out provider-backed retrieval benchmark. Final answer generation remains a separate evaluation.':'Offline held-out partial-core diagnostic. This is not the complete ContextWeave product-effect benchmark.',created_at:new Date().toISOString(),commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dataset_sha256:createHash('sha256').update(JSON.stringify(stableDataset)).digest('hex'),node:process.version,k,ingested_events:events.length,memories:all.length,questions_total:questions.length,heldout_questions:questions.filter(q=>q.split==='heldout').length,vector_threshold_selected_on_dev:vectorThreshold,provider_mode:realProviders?'configured-vps-routes':'offline-proxy',provider_status:providerStatus?{model:providerStatus.model,dimensions:providerStatus.dimensions,indexed_count:providerStatus.indexed_count,eligible_count:providerStatus.eligible_count,collection:providerStatus.collection}:null,jev_status_counts:Object.fromEntries([...new Set(jevStatuses.map(item=>item.jev_status))].map(status=>[status,jevStatuses.filter(item=>item.jev_status===status).length])),coverage:{enabled:['gateway candidate ingestion','Lineage current/superseded state','Recall Profile','Entity Registry links','structured temporal scope','SQLite FTS/situation retrieval','progressive T0/T1/T2 roles','Answer Authority','packing and no-context output',...(realProviders?['isolated Qdrant collection','configured neural embeddings','Jev/Decision Model','associative vector expansion']:[])],not_enabled:[...(!realProviders?['Qdrant and production neural embeddings','Jev/Decision Model semantic judgment','associative vector expansion']:[]),'full host query representation topics/hypotheses','Arc/relation navigation corpus','long-memory source expansion','final answer generation and groundedness scoring']},results,limits:['All systems receive the same host-supplied synthetic memory candidates, held-out questions and deterministic temporal scope classification.','The synthetic deployment loads a Recall Profile and explicit Entity Registry links; names and aliases remain discovery metadata rather than direct evidence.','ContextWeave candidates enter through ingestCandidateWithFamily; corrections create real Lineage revisions.',realProviders?'Vector-only, hybrid and ContextWeave use the same configured neural embedding route and isolated Qdrant collection.':'The vector lane is a deterministic TF-IDF proxy shared by vector-only, hybrid and ContextWeave; it is not a neural embedding model.',realProviders?'Jev fallback/provider failures are recorded and invalidate a full-pipeline claim for the affected queries.':'ContextWeave semantic judgment/Jev and answer generation are not configured locally, so this is a partial-core diagnostic rather than the full paid-pipeline benchmark.','Questions are scored on evidence retrieval only. Correct abstention is a strict no-context metric; extra same-entity context is not by itself proof that the final answer would hallucinate.','The current aggregate ID metric does not yet separately score T0 factual, T1 supporting and Answer Authority fields, so it must not be used to claim an entity-collision failure.','Privacy/policy tests and end-to-end answers remain separate.','Gateway ingestion generates UUID memory IDs. Exact-score ties therefore produce small cross-run Top-1/MRR variation.']};
const dir=new URL('evaluation/results/',root);mkdirSync(dir,{recursive:true});writeFileSync(new URL('product-core.json',dir),JSON.stringify(report,null,2)+'\n');
const pct=x=>x==null?'N/A':`${(x*100).toFixed(1)}%`;
const lines=[realProviders?'# ContextWeave provider-backed retrieval benchmark':'# ContextWeave partial-core diagnostic','',report.label,'',`Commit: ${report.commit}`,`Dataset: ${report.dataset_sha256}`,'',`Synthetic events: ${report.ingested_events}; memories after Lineage: ${report.memories}; held-out questions: ${report.heldout_questions}; k=${k}.`,'',...(realProviders?[`Provider vector: ${report.provider_status?.model || 'unknown'} (${report.provider_status?.dimensions || 'unknown'} dimensions).`,`Jev statuses: ${JSON.stringify(report.jev_status_counts)}.`,'']:[]),'## Coverage','','Enabled: '+report.coverage.enabled.join('; ')+'.','','Not enabled: '+report.coverage.not_enabled.join('; ')+'.','','| System | Top-1 | MRR@5 | Strict evidence precision | Evidence recall | Strict no-context abstention | Queries with any non-gold context |','|---|---:|---:|---:|---:|---:|---:|'];
for(const [name,{summary:s}] of Object.entries(results))lines.push(`| ${name} | ${pct(s.top1_hit_rate)} | ${s.mrr_at_5.toFixed(3)} | ${pct(s.precision_micro)} | ${pct(s.recall_macro_answerable)} | ${pct(s.abstention_accuracy)} | ${pct(s.false_positive_query_rate)} |`);
lines.push('','## Category breakdown','','| System / category | n | Top-1 | Recall | Abstention |','|---|---:|---:|---:|---:|');
for(const [name,r] of Object.entries(results))for(const [category,s] of Object.entries(r.by_category))lines.push(`| ${name} / ${category} | ${s.questions} | ${pct(s.top1_hit_rate)} | ${pct(s.recall_macro_answerable)} | ${pct(s.abstention_accuracy)} |`);
lines.push('','## Limits','',...report.limits.map(x=>`- ${x}`),'','## Product-level interpretation','',realProviders?'This isolated provider-backed run measures the incremental retrieval effect of the configured ContextWeave pipeline against FTS, neural-vector-only and ordinary FTS+vector hybrid baselines on the same frozen corpus. It does not measure final answer generation or privacy/policy behavior.':'This run may support claims about the local ContextWeave core only. It cannot support claims about the complete provider-backed product until the same frozen dataset is run in an isolated deployment with the configured embedding and recall-judge routes.');
writeFileSync(new URL('product-core.md',dir),lines.join('\n')+'\n');
progress(`report written: ${fileURLToPath(new URL('product-core.md',dir))}`);
console.log(JSON.stringify({threshold:vectorThreshold,heldout:report.heldout_questions,results:Object.fromEntries(Object.entries(results).map(([name,r])=>[name,r.summary])),report:fileURLToPath(new URL('product-core.md',dir))},null,2));
db.close();
