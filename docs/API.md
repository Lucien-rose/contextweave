# Backend API

HTTP `/api/` routes and `/mcp` share the owner Bearer token. `/health` returns
`{ok, version}` without content or local paths. Stdio MCP uses the invoking process.
The API is single-owner; a multi-user host must isolate databases/credentials itself.

| Area | HTTP entrypoints | Contract source |
| --- | --- | --- |
| Recall and bootstrap | `POST /api/gateway/recall`, `/api/gateway/bootstrap` | `admin/routes/gateway.js`, `HOST_INTEGRATION.md` |
| Continuity | `/api/sync/*` | `admin/routes/gateway.js`, `continuity.js` |
| Memory and drafts | `/api/memories`, `/api/drafts` | `admin/routes/memory.js` |
| Changes and Lineage | `/api/evolution/*` | `evolution/contract.js`, `admin/routes/evolution.js` |
| Portrait read/update/seed | `POST /api/portraits/{read,update,seed}` | `portrait/contract.js` |
| Runtime and candidates | `/api/portraits/{runtime,observe,run,backfill,candidates}` | `portrait/runtime-contract.js` |
| Model configuration | `/api/models/connections`, `/api/models/routes/*` | `MODEL_RUNTIME.md` |
| Capsule catalog | `GET /api/window-capsules/catalog` | `window/contract.js` |
| Capsule processing | `POST /api/window-capsules/{publish,read,organize}` | `window/contract.js` |
| Steward | `POST /api/doctor/batches`, `GET /api/doctor/batches/:id`, `POST /api/doctor/run` | `doctor/contract.js` |
| Health | `GET /api/health/{status,runs}`, `POST /api/health/run` | `VECTOR_AND_HEALTH.md` |
| Vector migration | `/api/vector/migration/*` | `VECTOR_AND_HEALTH.md` |
| Atlas/entities/relations | `/api/arcs`, `/api/entities`, `/api/relations` | Respective domain `contract.js` files |
| Export | `GET /api/export` | Owner JSON export; use snapshot CLI for restore |

Method and payload details live in the linked contract modules rather than a second
handwritten schema. Inspect MCP `tools/list` for the exact current tool schema.
Host state, rolling transcript, temporary context slots and model cache behavior
are outside this backend. The small-model slot accepts bounded observations and
batches; it does not require one API call for every conversation turn.

Use stable idempotency/change IDs for retries. On a revision conflict, read the
current record and reconsider the change; do not blindly overwrite it. Model API
keys are accepted on save and encrypted at rest; listing configurations returns
key availability only, never plaintext keys. Host clients should clear the key
input after a successful save.
