# MCP runtime and administration surfaces

ContextWeave exposes two explicit MCP surfaces so conversation agents do not receive deployment and maintenance tools in their normal tool list.

| Surface | HTTP endpoint | Stdio command | Credential | Purpose |
| --- | --- | --- | --- | --- |
| Runtime | `POST /mcp/runtime` | `npm run start:stdio:runtime` | `MOSS_RUNTIME_TOKEN` or the admin token | Continuity, recall, evidence navigation and authorized memory intent |
| Admin | `POST /mcp/admin` | `npm run start:stdio:admin` | `MOSS_ADMIN_TOKEN` | Diagnostics, lifecycle review, graph curation and maintenance |
| Compatibility | `POST /mcp` | `npm run start:stdio` | `MOSS_ADMIN_TOKEN` | Deprecated combined inventory for existing clients |

New remote integrations should configure separate random runtime and admin tokens. The admin token is accepted by the runtime endpoint for owner operation. The runtime token is never accepted by the admin or compatibility endpoint. When `MOSS_RUNTIME_TOKEN` is absent, the runtime endpoint falls back to the admin token so existing installations continue to start unchanged.

The compatibility HTTP endpoint emits `Deprecation`, `Warning`, `Link` and `X-ContextWeave-MCP-Surface` headers. It remains available during the compatibility window; no existing tool has been renamed or removed from that endpoint.

Generate exact schema references locally with `npm run tools:document:runtime` or `npm run tools:document:admin`. The generated surface files are intentionally not committed; live `tools/list` remains authoritative after deployment overrides.

## Runtime inventory

The runtime surface currently exposes 28 tools in these groups:

- continuity: sync pull/push, bootstrap, Session Capsule catalog/read;
- recall: recall, expansion, source context, current-date recall, direct read, timeline and delivery receipt;
- authorized writes: draft, commit and memory intent;
- profiles: bounded lookup, evidence-backed update and observation queueing;
- read-only navigation: Atlas list/read/materials, entity list/read and relation discovery/read/list/paths/bundle.

It intentionally excludes deletion, restore, lifecycle migration, semantic diagnostics, proposal queues, graph mutation and summary maintenance.

## Admin inventory

The admin surface currently exposes 44 tools covering:

- runtime status and body-free recall diagnostics;
- source-context curation and portrait proposal processing;
- lifecycle audit, planning and apply;
- Lineage family review, delegation, undo, delete and restore;
- Atlas, entity and relation curation;
- pending summary maintenance.

Ordinary conversation bootstrap and recall are absent. Operators that also need runtime recall should connect a second MCP client to the runtime surface instead of widening the admin surface.

## Compatibility policy

The split changes tool discovery, not stored data or domain behavior. All three surfaces call the same domain services and SQLite authority. Existing clients may remain on `/mcp` while migrating, but new examples and SDKs must target an explicit surface. The future stable HTTP API will follow the same runtime/admin boundary.
