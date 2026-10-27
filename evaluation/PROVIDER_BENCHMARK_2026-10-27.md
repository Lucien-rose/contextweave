# ContextWeave initial provider-backed retrieval run

This report records the first successful isolated provider-backed product-effect run. It is an initial validation result, not yet the three-run formal benchmark required by `BENCHMARK_PLAN.md`.

## Run identity

- Date: 2026-10-27
- Commit: `f0560d0e98ad19ca9e713d504f231b0fc84449e2`
- Dataset SHA-256: `eba597f93f0ffce5486e68735fc617f3e4816198119d5fc6919bdf64345c8c96`
- Synthetic events: 80
- Memories after Lineage: 80
- Held-out questions: 106
- Retrieval limit: 5
- Embedding route: `openai/text-embedding-3-large`, 3072 dimensions
- Semantic judgment status: applied on 106/106 questions

## Aggregate results

| System | Top-1 | MRR@5 | Strict evidence precision | Evidence recall | Strict no-context abstention | Queries with any non-gold context |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SQLite FTS5 / BM25 | 76.3% | 0.860 | 17.9% | 100.0% | 43.3% | 87.7% |
| Neural vector only | 38.2% | 0.490 | 15.2% | 68.4% | 86.7% | 75.5% |
| FTS + neural vector | 72.4% | 0.817 | 16.7% | 96.1% | 43.3% | 87.7% |
| **ContextWeave full provider pipeline** | **97.4%** | **0.987** | **22.8%** | **100.0%** | **86.7%** | **66.0%** |

Against the strongest Top-1 baseline, the full ContextWeave route improved Top-1 retrieval by 21.1 percentage points and MRR@5 by 0.127 while preserving 100% evidence recall. Its strict no-context abstention matched the strongest baseline and exceeded the ordinary hybrid route by 43.4 percentage points.

## ContextWeave category results

| Category | Questions | Top-1 | Evidence recall | Abstention |
| --- | ---: | ---: | ---: | ---: |
| Current state | 10 | 80.0% | 100.0% | N/A |
| Direct fact | 14 | 100.0% | 100.0% | N/A |
| Historical state | 10 | 100.0% | 100.0% | N/A |
| Multi-record | 6 | 100.0% | 100.0% | N/A |
| Paraphrase | 12 | 100.0% | 100.0% | N/A |
| Preference | 6 | 100.0% | 100.0% | N/A |
| Reason | 6 | 100.0% | 100.0% | N/A |
| Temporal | 12 | 100.0% | 100.0% | N/A |
| Unanswerable | 16 | N/A | N/A | 75.0% |
| Unrelated | 14 | N/A | N/A | 100.0% |

## Coverage

The run enabled gateway candidate ingestion, Lineage current and superseded state, Recall Profile, explicit Entity Registry links, structured temporal scope, SQLite FTS and situation retrieval, progressive T0/T1/T2 roles, Answer Authority, packing and no-context output, an isolated Qdrant collection, configured neural embeddings, semantic judgment and associative vector expansion.

All compared systems received the same host-supplied synthetic memory candidates, held-out questions and deterministic temporal classification. Vector-only, hybrid and ContextWeave used the same configured neural embedding route and isolated corpus.

## Limits

- This run scores retrieved evidence IDs, not final generated answers or grounded citations.
- Privacy and policy behavior remain a separate evaluation because the baselines do not implement an equivalent contract.
- Full host-generated query topics and hypotheses, Arc navigation, long-source expansion and answer generation were not enabled.
- “Queries with any non-gold context” is a deliberately strict query-level diagnostic, not a false-recall or hallucination rate. It currently groups useful T1 support, acceptable T2 background and genuine noise together, and can favor systems that under-retrieve. The formal benchmark must report those roles separately.
- The aggregate ID metric does not separately score T0 factual evidence, T1 support and Answer Authority fields.
- Gateway ingestion generates UUID memory IDs, so exact-score ties may cause small Top-1 and MRR variation across runs.
- This is one provider-backed run. Two additional clean runs are required by the acceptance plan before publishing a formal three-run aggregate.

## Reproduction

The public runner creates an in-memory SQLite database and a uniquely named benchmark-only Qdrant collection. It copies production model settings to a temporary file, keeps production memory data untouched, writes Markdown and JSON reports under `/root`, and deletes the isolated collection before exit.

Run it only on a host with the configured encrypted model routes:

```sh
sudo bash scripts/run-vps-product-benchmark.sh
```

The runner now uses conservative single-input embedding requests with bounded retry and prints stage and per-system question progress. Full protocol and acceptance criteria are documented in [BENCHMARK_PLAN.md](BENCHMARK_PLAN.md).
