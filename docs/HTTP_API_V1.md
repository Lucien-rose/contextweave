# HTTP API v1

Use `/api/v1` for application clients. MCP clients continue to use `/mcp/runtime`
and `/mcp/admin`. Both transports call the same memory services; HTTP recall and
bootstrap share MCP request schemas, defaults and execution.

The normal workflow is `ingest → recall → evolve`. Inputs are host-interpreted
memory records, not raw conversations for automatic extraction. The host owns
meaning, user authority, prompt placement and source evidence.

## Authentication and versioning

Send `Authorization: Bearer TOKEN`. Runtime operations accept `MOSS_RUNTIME_TOKEN`
or the admin token. `/api/v1/admin/*` requires `MOSS_ADMIN_TOKEN`. Existing
single-token installations retain the admin-token fallback. Databases are
single-owner; tokens are not tenant or per-user isolation.

v1 preserves endpoint names, field meanings, defaults and error codes. Additive
response fields are allowed; clients must ignore unknown response fields. Changes
that remove fields or change semantics require a new API major version. Requests
reject unknown top-level fields to catch misspelled options. Nested objects follow
their published schemas. Legacy `/api/*` routes remain compatible and admin-only.

`GET /api/v1/schema` returns the operation inventory and generated input JSON
Schemas inside `data`. Domain refinements also run at request time, including the
requirement that episode records use `append_episode`. The schemas are generated
from executable contracts; no second handwritten request schema is maintained.

## Endpoints

| Method | Path after `/api/v1` | Credential | Successful `data` |
| --- | --- | --- | --- |
| POST | `/ingest` | Runtime | Change receipt or `review_required` |
| POST | `/recall` | Runtime | Bounded recall response |
| POST | `/evolve` | Runtime | Change receipt or `review_required` |
| POST | `/read` | Runtime | Context-checked memory expansion |
| POST | `/bootstrap` | Runtime | Context Seed, schema version 3 |
| POST | `/recall/delivered` | Runtime | Delivery acknowledgement |
| POST | `/changes/read` | Runtime | Body-free receipt for `change_id` |
| GET | `/admin/reviews` | Admin | `{reviews: [...]}` pending/planned inbox |
| GET | `/schema` | Runtime | `{api_version, operations}` |

All POST endpoints require `Content-Type: application/json`, with a 256 KiB body
limit. Unsupported methods return 405 and `Allow`; unknown endpoints return 404.
Responses are `Cache-Control: no-store`.

## Response envelope

Successful operations return HTTP 200, including domain decisions that require
review. Always inspect `data.status` before describing a memory as saved.

```json
{
  "api_version": "1",
  "data": {"status": "applied", "memory_id": "memory:..."},
  "meta": {"request_id": "..."}
}
```

`meta.request_id` matches `X-Request-ID`. Recall may also return
`meta.recall_status`: host-only provider/fallback diagnostics that do not belong
in the model's memory context. Keep this separate from `data.memories` and
`data.background_memories`.

Errors have no `data` field:

```json
{
  "api_version": "1",
  "error": {"code": "invalid_request", "message": "Request validation failed",
    "issues": [{"path": ["query"], "code": "invalid_type", "message": "..."}]},
  "meta": {"request_id": "..."}
}
```

| HTTP | `error.code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | Invalid JSON, schema or delivery input |
| 401 | `unauthorized` | Missing/invalid credential |
| 403 | `forbidden` | Runtime credential used for an admin operation |
| 404 | `not_found` | Unknown endpoint, memory or change |
| 405 | `method_not_allowed` | Wrong method for an existing endpoint |
| 409 | `conflict` | Applied `change_id` reused with different input |
| 410 | `gone` | Delivery receipt is no longer available |
| 413 | `payload_too_large` | Request exceeds the body limit |
| 415 | `unsupported_media_type` | JSON content type required |
| 500 | `internal_error` | Unexpected server failure; private details withheld |

`message` and validation `issues` help humans diagnose errors; clients branch on
HTTP status, `error.code` and domain `data.status`/`reason`, not message text.

## Ingest and evolve

Minimal delegated preference input:

```json
{
  "change_id": "host:message-42:preference",
  "family_key": "user:travel-pace",
  "title": "Travel pace",
  "content": "Prefers no more than two major stops per day.",
  "source_refs": [{"source_type": "conversation", "source_id": "message-42",
    "excerpt": "Please keep trips to two major stops per day."}]
}
```

`ingest` defaults to `operation=create`, `authority=delegated`,
`lifecycle_class=belief`, `risk=low`. Hosts must override those defaults when the
meaning differs. Events use `operation=append_episode` and
`lifecycle_class=episode`. Optional `memory_kind` and `attributes` preserve the
existing memory contract, including recall summaries and sensitivity policies.

Delegation is disabled on fresh installations. It is configured by the owner
through the existing admin policy API; v1 never enables it automatically. A real
explicit user correction can use `authority=user_correction` with an accurate
`user_instruction`. Authority is asserted by a trusted host, not inferred by the
server from arbitrary conversation text.

`evolve` accepts `reinforce`, `supersede`, `coexist` and `correct`, with the full
intent fields plus required `target_memory_id`, `expected_content_hash` and
`expected_updated_at` from the inspected current memory. Use `read` in the
appropriate context to inspect that target. Updates preserve the existing
Lineage and policy decisions.

An applied receipt contains `change_id`, `family_key`, `memory_id`, `target_id`,
`operation`, `authority`, `status`, `created_at`, and `notification`; retries add
`replay=true`, and optional maintenance results may be attached. A review decision contains `status=review_required`,
`reason`, `review_id`, `family_key`, `canonical_memories_changed=false`.
Stale targets, disabled delegation and ambiguous meaning return this domain
decision with HTTP 200; they do not overwrite the current record. The admin inbox
includes the proposed intent for inspection. There is no blind approve endpoint:
the host inspects evidence and submits an accurate intent under current authority.

Use a stable `change_id` across retries of the same write. An applied change is
replayed without repeating writes or maintenance. A different input under that
applied ID returns 409. Pending reviews are family-scoped and can be reconsidered;
they are not immutable applied receipts. `/changes/read` returns 404 until a
durable change receipt exists. If a response is lost, retry the identical request
with its original ID. Optional post-write maintenance may contact configured
models; it does not grant write authority.

## Recall, read and delivery

Ordinary recall includes a `receipt` reference. Owner hosts can inspect titled
results, blocked candidates and the submitted query through the admin-only
`POST /api/v1/recall/receipt`. See [Recall Receipt](RECALL_RECEIPT.md) for fields,
retention and host context-placement requirements.

Start with `{"query":"What travel pace does the user prefer?"}`. Context defaults
to `general` and intimacy to `off`. Advanced options such as budgets, context
envelopes, version/time intent, Jev, vectors and repetition policy retain their
existing meanings; see the generated schema and [Host Integration](HOST_INTEGRATION.md).

Recall `data` contains `query`, `route`, `verification`, `memories`,
`background_memories`, `background_mode=separate`, `guidance`, and an optional
`delivery`. `NO_RECALL` with an empty list is successful abstention. A `VERIFY`
route provides leads, not proof of current facts. Provider failure can use the
documented local fallback and is reported separately in `meta.recall_status`.

`read` requires `memory_id` and the live `query`; it accepts `context`,
`intimacy_mode`, `context_envelope`, `detail` and `max_chars`. It uses the existing
expansion policy, so known IDs do not bypass context gates. Available responses
include a memory card with `content`, `content_hash`, `updated_at`, `version`, `detail_level`,
`truncated` and `available=true`. Gated records return `available=false` and a
`reason` without content; missing records return 404. Owner-only full-history
reads remain on the admin API. Memory-card navigation hints may still name MCP
tools; HTTP hosts open admitted memories with `/read`.

Recall defaults to immediate recording, matching MCP. For reliable host
integration, use `delivery_mode=confirmed`; no read count/cooldown is recorded
until the host calls `/recall/delivered` with the prepared `receipt_id` and exactly
the selected `memory_ids` it successfully injected. Failed injection needs no
acknowledgement. Same-receipt/same-ID retries are idempotent. The response contains
`status=delivered`, `duplicate`, `recorded_count`. A receipt with different IDs is
rejected; absent/expired receipts return 410. Immediate recalls are not idempotent
and should not be blindly retried after an ambiguous timeout.

## Runnable example

With a running backend and a runtime token:

```sh
export MOSS_BASE_URL=http://127.0.0.1:2091
export MOSS_RUNTIME_TOKEN=YOUR_RUNTIME_TOKEN
npm run example:http
```

With Compose, run `docker compose exec contextweave moss example-http`; the
container command loads its persisted runtime credential.

The example explicitly saves one synthetic record, recalls and reads it, then
acknowledges delivery in a simulated host. It leaves that synthetic record in
the database. No paid model is needed for recall in this sample. TypeScript and
Python SDKs will wrap this contract after API review.
