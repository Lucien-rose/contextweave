# Unreleased — HTTP API v1 and SDK previews

Changes since 1.3.0; this section does not announce a new tagged release.

- Versioned HTTP application API for ingest, recall, evolution, context-checked
  reads, bootstrap, delivery acknowledgements, change receipts and admin reviews.
- TypeScript SDK preview with generated request types, ESM/CommonJS exports,
  timeout/cancellation and structured API/transport errors.
- Python SDK preview with generated request types and method paths, synchronous
  and asynchronous Runtime/Admin clients, typed responses and wheel/sdist packages.
- Recall admission fixes preserve qualified T2 associations while requiring
  grounded association paths and answer utility. Ordinary relevance uses 0.75;
  association path fit retains 0.8. Successful no-utility judgments can suppress
  direct identity material without removing the local fallback for model failure.
- Both SDKs preserve review-required decisions and confirmed delivery semantics.
  They connect to the backend selected by each deployer and do not select a shared
  hosted service. No automatic retries are performed.

SDK versions remain provisional 0.1.0 previews available from source. Neither npm
nor PyPI publication is enabled. The backend package remains at 1.3.0 until release
preparation assigns the next version. Existing private deployments are not updated
automatically, and this batch adds no database migration.

See [HTTP API v1](docs/HTTP_API_V1.md), [TypeScript SDK](packages/sdk-typescript/README.md),
[Python SDK](packages/sdk-python/README.md) and [validation](RELEASE_VALIDATION.md).

中文：本批次补齐版本化 HTTP 接口、TypeScript 与 Python 接入包，并收录召回门禁修复。
两份 SDK 均连接使用者自己指定的后端，保留审核、权限和送达确认语义。
当前为源码预览，尚未发布新的 GitHub Release 或 npm/PyPI 包。

# ContextWeave 1.2.0

Portable memory-package import and a complete bilingual onboarding guide.

- New `npm run memory:import` CLI accepts JSON packages or memory arrays, with read-only dry-run by default.
- Preview reports new, duplicate, conflicting and invalid records without printing memory bodies.
- Explicit `--apply` runs append-only, transactional imports; `--skip-problems` can import safe new records after review.
- Imported memories retain supported fields and evidence excerpts, generate audit/Lineage receipts, refresh local search and queue vector work.
- Existing canonical and deleted IDs are never overwritten or reused. Owner JSON export is a **partial** import source, not a full restore.
- English and Chinese README now include deployment and post-install import instructions.
- Added the project architecture artwork and a cross-session demo GIF to the bilingual README.

For full database recovery, continue to use the verified SQLite snapshot restore workflow. Import does not reconstruct historical portraits, source materials, Lineage changes, continuity, tombstones or vector generations.

See [memory import](docs/MEMORY_IMPORT.md) for examples, safeguards and deployment steps.

# ContextWeave 1.1.0

Long T0 recall now opens a relevant original-text window. Configured Decision Models
can select ordinary recall candidates with local fallback, and soft-gated useful
material can use the existing bounded background lane. Host-only status explains
fallback without entering the memory text.
The semantic snapshot reserves room for every locally selected result before
exploratory candidates, preventing a valid no-result judgment from leaking
unreviewed tail candidates. The first local selection is computed without recording
a delivery, so the active semantic route receives the same priority set used by
ordinary recall. Uncertain indirect candidates are omitted while direct matches stay
protected, and the read-only trace reports the active route status.

This release also adds confirmed per-surface cooldown, independent recall/portrait/
Lineage judgment routes, read-only Atlas relationship leads, and reviewable Lineage
partition plans. Existing MCP names and owner endpoints remain compatible.

Read [upgrade contracts](docs/RECALL_UPGRADE.md) before host integration. A configured
legacy Decision Model now defaults to active ordinary recall; set `CW_JEV_MODE=off`
to retain prior model-free recall. No new provider is selected, no memory is
automatically rewritten, and old vectors need no forced rebuild.

# ContextWeave Core 1.0.0

The first public source distribution: a self-hosted, single-owner memory backend.

- SQLite authority, immutable source evidence and versioned Lineage changes.
- Layered recall with optional vectors, separate main/background budgets and
  progressive expansion from cues to originals.
- Stable, chapter and living portraits; bounded small-model queues and review proposals.
- Session Capsules, continuity APIs, Atlas navigation and offline Steward batches.
- Encrypted model connections, Index Generations with cutover/rollback, daily/weekly health checks.
- Standalone HTTP/MCP entrypoints, Linux installer, snapshot/restore CLI,
  configurable neutral defaults and a schema-generated reference for 60 MCP tools.

Apache-2.0. Created by Phina in collaboration with Lucien (OpenAI Codex).
No private frontend, personal Skill, production configuration, real memories,
credentials or original repository history is included. Existing moss_* tools,
MOSS_* settings, storage fields and service paths remain compatible identifiers.

Host conversation ingestion, window state, prompt composition and proactive
interaction require host integration. See docs/HOST_INTEGRATION.md and docs/ROADMAP.md.
Model processing starts disabled; no paid-provider compatibility is claimed
without testing the chosen account/model. See RELEASE_VALIDATION.md for checks.

Public source: https://github.com/Lucien-rose/contextweave

No npm registry package or live deployment is included. Use a separate deployment
rather than overwriting an existing private application.
