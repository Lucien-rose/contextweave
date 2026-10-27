# ContextWeave three-run provider-backed retrieval benchmark

This report records three clean isolated provider-backed retrieval runs on one frozen corpus. It measures retrieval and abstention, not final answer generation, privacy-policy behavior or production-user generalization.

## Benchmark identity

- Date: 2026-10-27
- Dataset SHA-256: `eba597f93f0ffce5486e68735fc617f3e4816198119d5fc6919bdf64345c8c96`
- Synthetic events: 80
- Memories after Lineage: 80
- Held-out questions: 106
- Answer-bearing questions: 76
- No-context questions: 30, comprising 16 unanswerable and 14 unrelated controls
- Retrieval limit: 5
- Embedding route: `openai/text-embedding-3-large`, 3072 dimensions
- Semantic judgment status: applied on 106/106 questions in every run

| Run | Commit | Dataset | Provider status |
| --- | --- | --- | --- |
| 1 | `f0560d0e98ad19ca9e713d504f231b0fc84449e2` | frozen hash above | embeddings and Jev applied |
| 2 | `f0fe3c316fff6f06b567a2026d5d179db688ba6c` | frozen hash above | embeddings and Jev applied |
| 3 | `f0fe3c316fff6f06b567a2026d5d179db688ba6c` | frozen hash above | embeddings and Jev applied |

The fixture, labels and scoring logic were unchanged across the three runs. The later commit only hardened benchmark transport and progress reporting. UUID assignment can change exact-score tie order, so small baseline Top-1 and MRR differences are expected and are reported below.

## Three-run mean

| System | Top-1 | MRR@5 | Strict evidence precision | Evidence recall | Strict no-context abstention |
| --- | ---: | ---: | ---: | ---: | ---: |
| SQLite FTS5 / BM25 | 75.4% | 0.855 | 17.9% | 100.0% | 43.3% |
| Neural vector only | 38.2% | 0.490 | 15.2% | 68.4% | 86.7% |
| FTS + neural vector | 72.0% | 0.810 | 16.5% | 94.8% | 43.3% |
| **ContextWeave full provider pipeline** | **97.4%** | **0.986** | **22.8%** | **100.0%** | **86.7%** |

Against the strongest Top-1 baseline in each run, ContextWeave improved Top-1 retrieval by a mean **22.0 percentage points** and MRR@5 by **0.131**, while preserving 100% evidence recall. Its strict no-context abstention matched the strongest baseline and exceeded the ordinary hybrid route by 43.4 percentage points.

## Run-level stability

Values below are mean +/- sample standard deviation across three runs. The 95% intervals use a two-sided t interval with two degrees of freedom. With only three runs, they describe observed run-to-run instability on this frozen benchmark; they are not population-generalization intervals.

| System | Top-1 mean +/- SD | Top-1 range | Approx. 95% interval | MRR@5 mean +/- SD | MRR range | Approx. 95% interval |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SQLite FTS5 / BM25 | 75.4 +/- 0.8% | 75.0-76.3% | 73.6-77.3% | 0.855 +/- 0.004 | 0.853-0.860 | 0.845-0.865 |
| Neural vector only | 38.2 +/- 0.0% | 38.2-38.2% | 38.2-38.2% | 0.490 +/- 0.000 | 0.490-0.490 | 0.490-0.490 |
| FTS + neural vector | 72.0 +/- 0.8% | 71.1-72.4% | 70.1-73.8% | 0.810 +/- 0.009 | 0.800-0.817 | 0.788-0.833 |
| **ContextWeave full provider pipeline** | **97.4 +/- 0.0%** | **97.4-97.4%** | **97.4-97.4%** | **0.986 +/- 0.001** | **0.985-0.987** | **0.983-0.989** |

The paired ContextWeave Top-1 improvement over the strongest baseline was 22.0 +/- 0.8 percentage points, with an approximate 95% run-level interval of 20.1-23.8 points. The paired MRR@5 improvement was 0.131 +/- 0.004, with an approximate interval of 0.122-0.140.

## Per-run aggregate results

| Run | System | Top-1 | MRR@5 | Strict evidence precision | Evidence recall | Strict no-context abstention | Any non-gold context diagnostic |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | SQLite FTS5 / BM25 | 76.3% | 0.860 | 17.9% | 100.0% | 43.3% | 87.7% |
| 1 | Neural vector only | 38.2% | 0.490 | 15.2% | 68.4% | 86.7% | 75.5% |
| 1 | FTS + neural vector | 72.4% | 0.817 | 16.7% | 96.1% | 43.3% | 87.7% |
| 1 | **ContextWeave full provider pipeline** | **97.4%** | **0.987** | **22.8%** | **100.0%** | **86.7%** | **66.0%** |
| 2 | SQLite FTS5 / BM25 | 75.0% | 0.853 | 17.9% | 100.0% | 43.3% | 87.7% |
| 2 | Neural vector only | 38.2% | 0.490 | 15.2% | 68.4% | 86.7% | 75.5% |
| 2 | FTS + neural vector | 71.1% | 0.800 | 16.2% | 92.8% | 43.3% | 87.7% |
| 2 | **ContextWeave full provider pipeline** | **97.4%** | **0.987** | **22.8%** | **100.0%** | **86.7%** | **66.0%** |
| 3 | SQLite FTS5 / BM25 | 75.0% | 0.853 | 17.9% | 100.0% | 43.3% | 87.7% |
| 3 | Neural vector only | 38.2% | 0.490 | 15.2% | 68.4% | 86.7% | 75.5% |
| 3 | FTS + neural vector | 72.4% | 0.814 | 16.7% | 95.4% | 43.3% | 87.7% |
| 3 | **ContextWeave full provider pipeline** | **97.4%** | **0.985** | **22.8%** | **100.0%** | **86.7%** | **66.0%** |

The final column is deliberately excluded from the headline table. It is a query-level diagnostic that marks a query when any returned ID is outside the answer-bearing gold set. It currently mixes useful T1 support, bounded T2 background and genuine noise, and it can reward systems that under-retrieve. It is not a false-recall or hallucination rate.

## Stable ContextWeave category results

The ContextWeave category results below were identical in all three runs.

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

The runs enabled gateway candidate ingestion, Lineage current and superseded state, Recall Profile, explicit Entity Registry links, structured temporal scope, SQLite FTS and situation retrieval, progressive T0/T1/T2 roles, Answer Authority, packing and no-context output, an isolated Qdrant collection, configured neural embeddings, semantic judgment and associative vector expansion.

All compared systems received the same host-supplied synthetic memory candidates, held-out questions and deterministic temporal classification. Vector-only, hybrid and ContextWeave used the same configured neural embedding route and isolated corpus.

## Limits

- These runs score retrieved evidence IDs, not final generated answers or grounded citations.
- Privacy and policy behavior remain a separate evaluation because the baselines do not implement an equivalent contract.
- Full host-generated query topics and hypotheses, Arc navigation, long-source expansion and answer generation were not enabled.
- Role-aware T0/T1/T2 utility labels are not yet included, so the non-gold-context diagnostic cannot distinguish useful support or intentional background from irrelevant intrusions.
- The aggregate ID metric does not separately score Answer Authority fields.
- Gateway ingestion generates UUID memory IDs, so exact-score ties may cause small Top-1 and MRR variation across runs.
- The three-run intervals describe provider and tie-order repeatability on one frozen synthetic dataset. They do not establish confidence on real-user data.

## Reproduction

The public runner creates an in-memory SQLite database and a uniquely named benchmark-only Qdrant collection. It copies production model settings to a temporary file, keeps production memory data untouched, writes Markdown and JSON reports under `/root`, and deletes the isolated collection before exit.

Run it only on a host with the configured encrypted model routes:

```sh
sudo bash scripts/run-vps-product-benchmark.sh
```

The runner uses conservative single-input embedding requests with bounded retry and prints stage and per-system question progress. Full protocol and acceptance criteria are documented in [BENCHMARK_PLAN.md](BENCHMARK_PLAN.md).
