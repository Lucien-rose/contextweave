# ContextWeave 1.1.0

Long T0 recall now opens a relevant original-text window. Configured Decision Models
can select ordinary recall candidates with local fallback, and soft-gated useful
material can use the existing bounded background lane. Host-only status explains
fallback without entering the memory text.

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
