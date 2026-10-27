# ContextWeave product-effect benchmark

## Question

How much does the complete ContextWeave pipeline improve memory-grounded answers over simpler memory backends when every system receives the same source conversations, questions, models and budgets?

Feature switches inside ContextWeave are secondary ablations. They explain an observed gain or failure after the main comparison; they are not the main result.

## Compared systems

1. `sqlite-fts`: canonical active text searched with SQLite FTS5/BM25.
2. `vector-only`: identical memory records embedded and ranked only by vector similarity.
3. `hybrid`: FTS and vector candidates merged with a fixed shared top-k budget.
4. `contextweave-full`: normal write/evolution path, Lineage and Answer Authority, hybrid retrieval, semantic judgment, privacy/context gates, tiering and packing.
5. `no-memory` (answer-stage reference only): the answering model receives only the current question. This measures how much apparent success comes from model prior knowledge or guessing.

All systems must use the same embedding model, answering model, source conversations, question text, maximum retrieved items and maximum retrieved characters. Provider versions, parameters, token usage, cost, failures and fallback states are recorded. A ContextWeave request that falls back to local retrieval is scored as fallback, not as a successful full-pipeline run.

## Dataset

Use synthetic people and projects with no private records. Feed source events through each system's normal ingestion boundary rather than inserting pre-curated answer records directly.

The dataset must include:

- direct facts and paraphrases;
- preference updates where current and historical answers differ;
- corrections, contradictions and explicit coexistence;
- two similar events involving the same entity;
- multi-session questions requiring evidence from separate sessions;
- temporal questions and “as of” questions;
- unanswerable and unrelated questions;
- entity collisions and topic-adjacent distractors;
- long source material where one passage is relevant;
- private/public context pairs for separate policy evaluation.

Split families, entities and phrasings between development and held-out sets. Do not tune thresholds or prompts on held-out results. Freeze each dataset version with a content hash.

## Two evaluations

### Retrieval

Score answer-bearing evidence independently of the final language model:

- Recall@k and Precision@k;
- MRR and top-1 hit rate;
- correct abstention / NO_RECALL accuracy;
- current-state accuracy and historical-state accuracy;
- contradiction and stale-version retrieval rate;
- returned characters/tokens, latency and provider cost.

### End-to-end answers

Give one fixed answering model the retrieved context through one shared prompt. Score exact or structured answers where possible, plus groundedness, citation/evidence correctness, contradiction, abstention, latency, tokens and cost. The answering model never sees expected labels.

## Policy tests

Privacy and context gates are tested in a separate suite because an unrestricted FTS/vector baseline has no equivalent policy contract. Report allowed recall, blocked recall, safe projection and leakage independently. Do not mix policy wins into relevance precision.

## Run protocol

1. Create a fresh isolated database and vector collection per system and run.
2. Ingest the same ordered source events through public host APIs.
3. Wait for and verify indexing; record rejected or failed writes.
4. Run every question once for accuracy. Repeat only latency measurements.
5. Persist raw candidates, final selected evidence, answer, route/fallback status and usage.
6. Score automatically, then manually review all disagreements and a sample of agreements.
7. Publish aggregate results with confidence intervals and per-category breakdowns. Keep raw synthetic results reproducible.

## Acceptance for the first formal run

- No private production database or personal memory content.
- No manually supplied query topics, hints or expected IDs.
- At least 100 held-out questions across the required categories.
- At least 25 unanswerable questions.
- Three clean runs for provider-dependent systems, with deterministic labels and separately reported variance.
- Full pipeline, vector-only and hybrid use the same embedding provider and corpus revision.
- Existing unit and integration tests remain green.

The current `pilot.json` and `pilot.md` remain local-route diagnostics. Live Jev on/off traces remain gate ablations. Neither is included in the formal product-effect score.
