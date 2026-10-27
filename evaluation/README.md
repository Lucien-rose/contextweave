# Local retrieval diagnostic

Run from the repository root after `npm ci`:

```sh
node scripts/evaluate-recall.js
```

The script creates an in-memory SQLite database with synthetic records. It explicitly disables vector and semantic providers, disables recall writes, and never opens a production database. It overwrites only `evaluation/results/pilot.json` and `pilot.md`. JSON contains all predictions, scores and timing observations; Markdown is the readable report.

This script diagnoses two local retrieval routes. It does not measure the product effect of the complete ContextWeave system. It excludes vector retrieval, semantic judgment, Lineage evolution, Answer Authority, multi-session ingestion and final answer generation. Do not use these numbers as the headline ContextWeave evaluation.

This is development data, not a public benchmark claim. The frozen fixture hash and source commit are recorded. Ten warm timing repetitions are not independent accuracy samples. Review every relevance label before using it to guide production changes; a strict answer-bearing relevance rubric can penalize context that is useful but cannot answer a question alone.

The FTS5 baseline uses the same active records, raw query text, five-result limit, fixed English stopwords, OR matching and BM25. ContextWeave uses its actual SQLite recall entry point with no manually supplied topics or hints. Language-specific results matter: unicode61 does not offer equivalent Chinese segmentation to ContextWeave's projections.

The product-effect benchmark is specified in [BENCHMARK_PLAN.md](BENCHMARK_PLAN.md). Next steps for this diagnostic:

Run `npm run evaluate:product-core` for an isolated, held-out partial-core diagnostic against FTS, vector-only and hybrid baselines. It generates `results/product-core.md`. Despite the command's historical name, this is not the complete product-effect benchmark: the report contains an explicit coverage inventory and must not be used as the headline ContextWeave result.

1. Add a separate held-out set before changing production ranking. Keep the pilot as development data.
2. Extend to real write/update history, historical queries, distractor scale, long records and separate policy tests.
3. Connect a dedicated embedding provider/vector collection for vector-only and hybrid baselines; use identical embeddings and record versions, indexing time and cost.
4. Run the full semantic pipeline with a dedicated provider connection. Record model, calls, input/output usage, errors and fallback state. A fallback run must not be labeled full-pipeline success.
5. Evaluate answer generation separately with a fixed answering model and shared prompt. Do not let it access expected labels.
6. Add a public benchmark adapter only after confirming dataset terms, protocol, source-time handling and scoring rules. Do not call this pilot LongMemEval.

No production scoring rules were changed based on this pilot. No paid calls are made by this command.

## Isolated provider-backed benchmark

`scripts/run-vps-product-benchmark.sh` is the VPS-only companion to the local diagnostic. Run it as root from a disposable checkout. It reuses the host's encrypted model routes but creates a uniquely prefixed Qdrant collection, uses an in-memory SQLite database, copies the Markdown and JSON reports to `/root`, and deletes the benchmark collection before exiting. It refuses to delete any Qdrant collection that does not match the benchmark-only naming rule.

The provider-backed report compares the configured ContextWeave retrieval pipeline with FTS5, neural-vector-only and ordinary FTS+vector hybrid baselines on the same frozen synthetic corpus. It still does not score final answer generation, privacy policy behavior or production data.

The first three clean provider-backed runs are aggregated in [PROVIDER_BENCHMARK_2026-10-27.md](PROVIDER_BENCHMARK_2026-10-27.md). The report publishes per-run values, three-run means, run-level variation and the frozen dataset identity. It keeps the non-gold-context rate as a diagnostic because the current labels do not yet distinguish useful T1 support, bounded T2 background and genuine noise.
