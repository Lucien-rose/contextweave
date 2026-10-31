# Recall receipt

Ordinary `/api/v1/recall` and `moss_recall` return a `receipt` reference with
`receipt_id` and `status`. Confirmed delivery also keeps the existing `delivery`
alias. Bootstrap and date recall retain their existing contracts.

An owner host reads details with admin credentials:

```http
POST /api/v1/recall/receipt
Content-Type: application/json
Authorization: Bearer <admin-token>

{"receipt_id":"delivery:..."}
```

The response uses the HTTP v1 envelope. Its `data` contains:

| Field | Meaning |
| --- | --- |
| `query` | Exact query text submitted for this recall |
| `status` | `prepared`, `delivered`, or `empty` |
| `latency_ms` | Recall duration, including provider waits; excludes receipt storage and network transport |
| `package_characters` | Serialized selected memory array length in JavaScript characters, including memory metadata; zero for empty recall |
| `memory_package_tokens` | Host-reported tokens in the injected memory package; null until reported |
| `routes` | FTS/vector queries executed, Jev judgments completed, fallback used |
| `items` | Selected references and bounded filtered/privacy-blocked references |
| `counts` | Total filtered and privacy-blocked candidates before detail truncation |

Each item has `memory_id`, `content_hash`, the title captured at recall time,
`tier`, and `result`. Selected items also record `detail_level` (cue, summary,
chunk or full). Filtered items have a reason code. Each omitted category stores
at most 24 detailed entries. Only candidates with a discovery signal qualify;
unrelated records visited during a database scan are excluded. Privacy-blocked
titles are owner audit data and are never included in ordinary recall results.

Confirmed receipts start as `prepared`. After actual injection, call the existing
`/api/v1/recall/delivered` or `moss_recall_delivered` with the selected IDs. Optional
`memory_package_tokens` reports the host's model-specific count. The first
acknowledgement fixes this value; retries return the existing outcome. Items become
`delivered` or `not_delivered` according to that acknowledgement. Immediate mode
assumes delivery, as before. Empty recalls are final and need no acknowledgement.

The receipt stores references and titles, with no memory bodies or request JSON.
The hash identifies the canonical memory version, not a stored copy of the exact
summary/chunk sent. Historical content availability depends on the memory store;
a hash alone cannot reconstruct it. Legacy receipts return minimal references,
with null titles and no query or route details.

Hosts must keep the receipt reference and details outside model messages to avoid
token use. The details endpoint is admin-only and has no MCP reader. Eden will
bind receipts to replies and render titles, tier groups and folded privacy audits.
Its Memory cache and synchronization are deferred. Viewing a receipt does not
record a memory read, trigger retrieval, or invoke a model.

Completed receipts expire after 30 days; prepared receipts after 90 days, through
existing explicit maintenance. Titles and query text are private audit data.

TypeScript: `ContextWeaveAdmin.receipt({ receipt_id })`.
Python: `ContextWeaveAdmin.receipt({"receipt_id": ...})`, also available on
`AsyncContextWeaveAdmin`. These SDK additions require this backend upgrade.
