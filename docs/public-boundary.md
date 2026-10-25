# Public boundary v3

The public package includes canonical SQLite storage, migrations, shared domain
services, MCP, owner HTTP APIs, model configuration, vector migration, health
inspection, snapshot/restore CLI and a standalone Linux installer.

Private UI, reading/gallery/device extensions, personal instructions, data and
credentials remain outside the closure. Generic core modules cannot import those
extensions. The private application composes them around the same memory backend.

## Repository contract

All repository methods are synchronous. Vector functions are asynchronous. The
pipeline treats returned records as immutable; an adapter can reuse objects while
their underlying data is unchanged.

| Method | Return / purpose |
| --- | --- |
| `beginRead()` | Start each pipeline pass; refresh request caches after intervening writes |
| `list(status)` | Canonical records of one status, including decoded tag/trigger arrays |
| `search(queries)` | FTS candidates: `{ items: [{ id, rank }], ...diagnostics }` |
| `situation(input, options)` | Context Lens candidates and diagnostics, or empty items when unavailable |
| `entities(query, policy)` | `Map<memoryId, entityId[]>` with namespace/context filtering applied |
| `lifecycle(memory)` | Lineage category and state history containing `memory_ids` and `validity` |
| `arcs(memories, policy)` | `Map<memoryId, membership[]>`, requested for selected full-card candidates |
| `markRecalled(ids)` | Record delivered recall when the caller enables `recordRecall` |

`lifecycle` may return null when a backend has no lifecycle data. Such a backend
can demonstrate ordinary recall but cannot claim disputed/coexisting family
support. The SQLite adapter provides those states using the same validity logic
as full lifecycle reads. A production adapter must also implement visibility,
record status and revision behavior appropriate to its storage.

The SQLite adapter lives for one request. It reuses candidate reads across seed
and final passes, checking SQLite's connection change count and external data
version before each pass. A rewrite during a vector await therefore refreshes
records and scoring. There is no cross-request result cache.

## Distribution

The source archive contains the backend, synthetic demonstrations and tests,
installer, license and integration documentation. It includes no repository
history, deployment state or personal agent policy. `npm run boundary:check`
checks common private paths and credential patterns; it cannot replace a release
review for application-specific identifiers. `npm run architecture:check` checks
module cycles, size budgets, duplicate functions and version authority.

The package is independently installable and uses Apache-2.0. It is intended for a fresh, separate deployment. Existing private deployments
require a migration review. Packaging does not publish a repository or registry.
