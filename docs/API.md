# Backend API

Legacy HTTP `/api/` routes use the admin Bearer token. MCP is split into the agent-facing
`/mcp/runtime` surface and the operator-facing `/mcp/admin` surface. The combined `/mcp`
endpoint remains as a deprecated compatibility route and requires the admin token. `/health`
returns `{ok, version}` without content or local paths. Stdio MCP uses the invoking process.
The API is single-owner; a multi-user host must isolate databases and credentials itself.

| Surface | Authentication | Status |
| --- | --- | --- |
| `POST /mcp/runtime` | `MOSS_RUNTIME_TOKEN`; admin token also accepted | Preferred agent integration |
| `POST /mcp/admin` | `MOSS_ADMIN_TOKEN` | Preferred operator integration |
| `POST /mcp` | `MOSS_ADMIN_TOKEN` | Deprecated combined compatibility surface |
| `/api/*` | `MOSS_ADMIN_TOKEN` | Existing owner API; stable `/api/v1` contract is a separate migration |
| `GET /health` | none | Health and version only |

If `MOSS_RUNTIME_TOKEN` is omitted, the runtime endpoint uses the admin token for backward-compatible deployment. See [MCP surfaces](MCP_SURFACES.md) for the tool boundary and migration policy.

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
| Local import | CLI: `npm run memory:import -- FILE.json --db DATABASE` | `MEMORY_IMPORT.md`; no remote upload endpoint |\n| Export | `GET /api/export` | Owner JSON export; use snapshot CLI for restore |

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

See [recall and navigation upgrade](RECALL_UPGRADE.md) for semantic/local routing,
host-only status, confirmed surface cooldown, Atlas leads and reviewable Lineage
partitions. These reuse the existing domain services and host delivery contract.
