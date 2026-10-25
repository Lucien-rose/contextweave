# Vector generations and local health checks

SQLite remains authoritative. Neither subsystem rewrites canonical memory or portraits.

## Migration

Keep both embedding endpoints addressable. One provider key may be used by multiple connections if the provider permits both models. Create and test a new embedding connection through the existing model API first. Do not assign the replacement to the global embedding route.

Owner API, behind the existing admin authentication:

- `GET /api/vector/migration`: deployment revision, generation headers and coverage.
- `POST /api/vector/migration/start`: `{ "connection_id": "replacement", "mode": "dual" }`.
- `POST /api/vector/migration/sync`: `{ "batchSize": 32, "maxBatches": 16 }`. Repeated calls resume missing work. The existing vector sync timer also services writable generations.
- `POST /api/vector/migration/compare`: `{ "queries": ["representative query"] }`. Explicitly calls both embedding models, stores body-free ID rankings, overlap and provider errors, and returns a check ID. Review the rankings; availability alone cannot prove recall quality.
- `POST /api/vector/migration/switch`: `{ "expected_revision": 1, "check_id": "returned-check-id" }`. Requires complete target coverage, no pending hard deletions, a successful candidate comparison and an unchanged canonical corpus since comparison.
- `POST /api/vector/migration/rollback`: `{ "expected_revision": 2 }`. Requires complete previous coverage and no pending deletions.
- `POST /api/vector/migration/retire`: `{ "expected_revision": 3 }`. Ends previous-generation writes and rollback eligibility after acceptance; retained collections remain untouched.
- `POST /api/vector/migration/cancel`: `{ "expected_revision": 1 }`. Returns to the active generation. Collections are retained, not destroyed.

CLI: `npm run vector:migration -- OPERATION /absolute/path/input.json`. Omit the file for status or default sync. Inputs never require a plaintext API key: they reference an existing tested connection.

First migration freezes the current blue configuration and the tested green configuration, including independent model, protocol, dimensions and collection. Credentials are encrypted in SQLite with the existing model encryption key. Back up that key separately; database exports omit encrypted deployment configuration. Runtime reads the active generation pointer on each request, including across separate admin and MCP processes. Changing an embedding route does not change the managed pointer.

Canonical writes invalidate all derived generations. Each generation independently finds missing state, so one successful side cannot acknowledge the other's work. Failures remain resumable; embedding failure does not delete existing points. A concurrent canonical change prevents an obsolete indexing result from being acknowledged. During managed recall, unacknowledged records are excluded until refreshed. Hard-deletion tombstones purge every collection under the configured prefix without needing an embedding key.

In dual mode, blue serves recall while both generations catch up. After switching, the previous generation remains writable for rollback. Retention is owner controlled: no old collection is automatically deleted, and retaining a writable rollback generation continues incurring embedding cost on new writes.

Use `forced` only when the old model can no longer produce embeddings. Blue writes stop. Green receives new records and the historical backfill. Each query tries blue and green independently; qualified candidates are merged by reciprocal rank, not raw cosine similarity. Failed old-provider queries produce an explicit degraded result while green, text search and Context Lens recall remain available. Rank-derived scores in this mode are ranking signals, not cross-model cosine measurements. Associative recall still uses the active model and may be unavailable until cutover. Rollback cannot pass with missing vectors.

The Qdrant endpoint/prefix and projection policy must stay stable during migration. A changed projection identity is rejected rather than silently mixing spaces. A provider that silently changes a model behind an unchanged name cannot be reliably identified by dimensions alone; use distinct versioned model IDs or distinct endpoints. No software can regenerate a retired embedding space without access to that model.

## Health inspection

`npm run health:check -- daily|weekly|status|runs` and authenticated APIs:

- `GET /api/health/status`: latest daily/weekly headers and open findings.
- `GET /api/health/runs`: bounded recent reports.
- `POST /api/health/run`: `{ "scope": "daily" }` or `weekly`.

The public installer deploy/moss-backend-install.sh installs daily/weekly timers using configurable systemd schedules in the server timezone. No LLM is called by health inspection. `moss_status` exposes the saved health summary; reading status does not launch a scan.

Daily checks cover SQLite quick check, foreign keys, expired worker leases, failed/review jobs, day-old pending jobs, pending vector deletions, active vector gaps, Qdrant reachability, and active collection dimensions/distance. Weekly checks add full SQLite integrity, policy declarations, active-memory reachability under the explicit private scene route, dangling Atlas and relation targets, malformed Lineage/capsule/Steward structured data, capsule source links, and Steward job/completion receipts. Weekly does not repeat paid recall benchmarks or judge semantic correctness of memories.

A stable finding code is updated across runs, preserving first/last observation. A successful later check resolves that finding; checks outside a daily scan are not incorrectly cleared. Reports are retained for 90 days; open findings remain until resolved. Repair guidance is included with each check. Existing sync/worker operations perform retries; health inspection itself only records findings and does not change memory content, clear inbox items, publish capsules or run Steward proposals.
