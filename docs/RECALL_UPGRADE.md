# Recall and navigation upgrade

## Semantic route and local fallback

A configured Decision Model now participates in ordinary asynchronous recall. It
judges a bounded discovery pool (up to 24 candidates / 12,000 serialized candidate
characters), rather than generating a second answer. The raw user query remains
authoritative; host facets are labeled inference. No canonical writes occur.

`jev_mode` accepts `off`, `observe`, or `on`. An explicit request overrides
`CW_JEV_MODE` (legacy `MOSS_RECALL_JEV_MODE` also works). With neither set, a
configured model defaults to `on`; an unconfigured installation uses local recall.
Set `off` to retain the previous behavior without model calls.

- `on`: semantic usefulness and priority replace heuristic tail decisions for
  judged candidates. Uncertain or uncovered candidates keep their local gates.
- `observe`: compute judgments but keep the local selection.
- Provider timeout, invalid/incomplete response, unavailable configuration or
  changed candidate snapshot: finish using local rules without repeating a model
  request. A valid all-omit response succeeds; it does not trigger fallback.
- Direct evidence stays protected. Audience, access policy, lifecycle authority,
  confirmed repetition control and budgets still apply to both routes.

A useful candidate that fails a soft formal-admission check can return as a short
background cue if its hard access checks passed. The model may also choose
background-only use. It does not become factual proof. Background cues share one
lane: default 1, up to 3 (`0` disables it), and one shared character budget. There
are no extra downgrade slots. Budget exhaustion alone never makes a candidate
eligible. If only background remains, the existing route is `AMBIENT` and the
main `memories` array is empty.

## Status belongs to the host

`POST /api/gateway/recall` adds a body-free `host_status` object when the semantic
route is requested. MCP puts the same data in result `_meta.recall_status`, outside
the text result. A JS host may supply `onRecallStatus(status)`.

Fields include `mode`, `recall_path` (`jev` / `local`), `jev_status`,
`fallback_used`, and an opaque `incident_id` for provider failures. No provider
response, API key or private snippet is included. The host must strip
`host_status` before assembling model context and use metadata only in its UI.
`recallResponse()` itself never includes these diagnostics. Frontend rendering is
not part of this release.

## Relevant windows for long direct memories

T0 bodies above 1,400 characters return a relevant original-text window with
`detail_level: relevant_chunk`, exact `chunk.start/end`, `content_hash`, and an
existing full-read entry. If a current vector body hit carries matching offsets,
selection stays inside that hit; otherwise it uses query/context terms against
reading windows. The stored original is untouched. Tight response budgets may
still reduce an item to a cue; `content_omitted` is explicit.

Newly synced vector points carry body offsets and content hash, not body text.
Existing points without offsets work immediately using query-based windows. No
forced re-embedding or vector-generation migration is required by this update.
The host can ask `moss_expand` for `relevant_chunk`, `summary`, or `full` when more
is needed. This is progressive reading, not an extra model-based sufficiency pass.

## Confirmed surface cooldown

Ordinary recall accepts an optional host-owned scope:

```json
{
  "delivery_mode": "confirmed",
  "recall_scope": {
    "client": "my-host",
    "surface": "window-123",
    "session": "session-456",
    "cooldown_hours": 24
  }
}
```

The same fields are used by HTTP and MCP. JS input uses `recallScope`.
`client` and `surface` are required together; `session` is optional audit metadata,
not part of cooldown identity. `cooldown_hours` defaults to 24 and accepts 0–168.
This default is configurable per request, not a mandatory product policy.

Call the existing delivery-acknowledgment endpoint/tool only after context
injection, and list only IDs actually injected. A prepared receipt has no cooling
effect. A repeated identical acknowledgment is idempotent. The ledger keys
client + surface + memory + content hash; another surface or changed body can
recall independently. `allow_repeat: true` explicitly bypasses repetition controls.
Only main-lane confirmations enter this ledger; background cooling is deferred.
A previously cooled main item cannot escape cooling by being relabeled background.
Legacy immediate delivery still updates global read bookkeeping but creates no
surface cooldown. Recent IDs/hashes supplied by the host retain their old behavior.

Ledger rows contain identifiers and hashes only. Deleting a memory cascades to its
ledger entries. Rows older than 30 days are pruned on confirmation and by explicit
receipt maintenance; they are already inactive after the configured cooldown.

## Atlas leads and Lineage plans

`moss_relation_discover` / `POST /api/relations/discover` accepts a seed
`memory_id` plus the existing namespace/context contract. It scans a bounded page
of 200 active memories, returning up to 20 leads (default 8), pinned source excerpts,
shared-entity/Lineage/tag hints, and coverage. Use `offset` / `next_offset` to page.
This is structural discovery, not exhaustive semantic relationship inference.
Shared tags or chronology do not prove causality. Inspect the originals, then use
existing relation propose/review APIs. Discovery creates no edges.

`moss_family_plan` / `POST /api/evolution/family/plan` consumes existing current
revision/sequence judgments and explicit supersession links. It returns a complete
before/after partition, evidence IDs, issues and a snapshot fingerprint. Missing
or contradictory judgments produce `needs_review`; they do not auto-merge records.
A ready plan contains `apply_request` for the existing `moss_family_group` / family
PUT endpoint. Applying rechecks the fingerprint. Content, lifecycle and provenance
are unchanged; no background grouping worker is introduced.
