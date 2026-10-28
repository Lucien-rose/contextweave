# Architecture

## Composition

`backend.js` assembles the public HTTP/MCP service. `mcp/memory-server.js` registers
one explicit runtime, admin or compatibility tool surface through `mcp/surfaces.js`;
`admin/routes/memory-api.js` registers the existing owner APIs. Every surface uses the
same domain services. `api/v1/` owns versioned HTTP contracts, envelopes and role
checks. `recall/request.js` shares recall/bootstrap input and execution with MCP;
neither transport invokes the other. Hosts compose their own interfaces around those services.

Runtime and admin are capability boundaries, not separate databases. The runtime token
cannot open admin or compatibility MCP. The deprecated compatibility surface preserves
the previous combined inventory while hosts migrate.

| Module | Responsibility |
| --- | --- |
| `database*`, `source-materials`, `memory-evidence` | Canonical SQLite storage, schema migration, evidence |
| `recall/` | Request preparation, candidate discovery, admission, ranking and budgets |
| `family/`, `evolution/` | Change receipts, coexistence, revisions, reviews and deletion |
| `portrait/`, `processing/` | Three portrait timescales, bounded queue and proposals |
| `window/`, `doctor/` | Published capsule versions and host-submitted offline batches |
| `models/`, `jev/` | Protocol adapters and encrypted configuration |
| `vector/`, `vector-*` | Derived index, generation migration and sync |
| `arc/`, `entity/`, `relation/` | Explicit evidence navigation |
| `health/`, `maintenance.js` | Saved inspection findings and housekeeping lifecycle |

Schemas import schema helpers rather than model execution or network services.
Database opening neither calls model APIs nor starts workers. Entrypoints own
background task startup and await shutdown before closing SQLite. Operations with
external awaits recheck the relevant revision or job lease before writing results.
Those checks protect real concurrent edits and remain part of the contract.

Public recall has one implementation. `recall/sqlite.js` adapts SQLite for the
pipeline; `demo/recall-repository.js` supplies synthetic records for the same pipeline.
Discovery may widen through context or vectors; answer authority remains grounded
in current-query evidence and canonical records.

## Maintenance rules

Prefer small domain modules and plain functions. Validate external input at API
and model boundaries; do not repeat schema validation in every internal helper.
Keep concurrency, evidence and deletion checks that protect stored data. Do not
turn a provider failure into a canonical rewrite or hide unexpected maintenance
errors. Avoid a generic plugin registry or dependency container for a fixed set
of services. See `CONTRIBUTING.md` for validation and change boundaries.

See [recall and navigation upgrade](RECALL_UPGRADE.md) for semantic/local routing,
host-only status, confirmed surface cooldown, Atlas leads and reviewable Lineage
partitions. These reuse the existing domain services and host delivery contract.
