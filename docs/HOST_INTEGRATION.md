# Host integration: Context Seed v3 and Portrait Runtime

This is a backend protocol, not a frontend implementation. No specific chat UI or private host orchestration is shipped here.

## Ownership

| Component | Owns |
| --- | --- |
| Memory service | Evidence-backed portraits, revisions, expiry, read/update interfaces, compact initialization bundle |
| Host/Gateway | Session storage, profile routing, context compilation, Seed placement, per-turn temporary slices, model-provider cache policy |
| Frontend | UI and user settings; outside this protocol |

The bundle is **initialization material**, not a chat message to append forever. Store it outside the canonical transcript. A host can cache structured profile partitions or keep their versioned read handles; it need not eagerly download the whole portrait.

## Context composition

Each request should contain a stable prefix (fixed instructions/tools + exactly one current Seed), selected real conversation history, at most one relevant profile slice, any needed memory evidence, and the current user message. Temporary profile input must not be saved as a user/assistant message.

Changing the rolling history from 20 to 30 exchanges does not affect Seed ownership. With a fixed Seed slot, no every-X-turn re-anchoring schedule is needed. A profile update replaces the relevant cached partition; Seed content changes replace its slot rather than append another copy.

Stable content order and bytes are conducive to prefix caching. Actual cache eligibility, retention, minimum lengths and hits remain provider-dependent. Cached tokens still occupy context and influence attention. Do not put changing body/emotional states, progress, timestamps or session IDs inside Seed.

With server-side append-only model conversations, do not allow old temporary slices to be inherited forever. Keep a canonical local transcript and rebuild requests when the provider cannot replace ephemeral context. Consume either a tool's structured result or its text representation, not both.

## Initialization

- MCP: `moss_bootstrap` returns schema 3 by default.
- Existing HTTP: `POST /api/gateway/bootstrap` keeps schema 2 when `schema_version` is omitted, so an unchanged host can keep working.
- New HTTP clients: explicitly send `schema_version: 3`.
- Public default budgets are documented in CONFIGURATION.md; tools/list exposes effective defaults.
  Explicit `total_budget_chars` always remains a hard ceiling (2048–24000).
- A new profile store starts empty. Seed can temporarily fall back to at most four admitted legacy identity/agreement summaries; no historical record is silently rewritten into a portrait.

Schema 3 returns `portrait_seed`, `available_profile_domains`, a host-only `profile_manifest`, bounded `current_chapter_index`, `active_living_snapshot`, `continuity_seed`, and `observances`. It does not return default deep reads, full contracts or a duplicate `memories` alias.

Keep raw `profile_manifest` out of model input. Include only model-relevant Seed/slices; version metadata is for host bookkeeping. Profiles are untrusted reference data, not instructions.

## Profile reads and updates

Authenticated endpoints:

- `POST /api/portraits/read`: bounded domain/time-scale/item lookup.
- `POST /api/portraits/seed`: stable Seed projection.
- `POST /api/portraits/update`: one revision-guarded change.

MCP equivalents: `moss_profile_lookup`, `moss_profile_update`.

Read parameters include `subject_id`, `context`, `intimacy_mode`, `query`, `domains`, `time_scales`, `item_ids`, `max_chars`, `include_evidence`, and `include_inactive`. Query lookup is deterministic lexical ranking, not an extra model call; use explicit domains/IDs for semantic routing. The normal path returns only active, unexpired items. Use `include_inactive` to inspect paused/expired items before a targeted update, not for default prompt input. General/public context returns no private portrait content.

Updates use a stable `item_id`, unique `change_id`, `expected_revision` (0 for creation), `operation` (`upsert` or `reinforce`), and nonempty `source_refs`. Conflicting retries are rejected; identical retries return their original receipt. A repeated stable item with identical canonical content converges on its existing ID. Semantic equivalence across different wording belongs to the writer/judge, not hash matching.

Example update:

```json
{
  "change_id": "message-42:cognitive:upsert",
  "subject_id": "user",
  "item_id": "cognitive:explanation-style",
  "expected_revision": 0,
  "operation": "upsert",
  "data": {
    "domain": "cognitive",
    "time_scale": "stable",
    "title": "Explanation style",
    "content": "Prefer plain language with concrete examples.",
    "seed_eligible": true,
    "use_policy": "silent"
  },
  "source_refs": [{"source_type": "conversation", "source_id": "message-42"}]
}
```

`chapter` items may carry structured goals, current phase, recent progress, unresolved points and expected end date. Update progress in place; completion, pause, restart or abandonment must be supported by evidence. Inactivity alone never completes a chapter.

`living` items require an explicit future `expires_at`. Expired items disappear from normal reads immediately, even before maintenance. Their derived body/evidence links are cleared the configured grace period after expiry. A clear same-episode re-mention within the grace window may reinforce it with a new future expiry. After grace, or for a distinct recurrence, use a new episode ID. Raw memory/source evidence is not deleted. A body-free ID tombstone prevents accidental resurrection.

Use policies are `silent`, `natural`, `explicit_only`. Let profiles personalize answers without repeatedly announcing them.

## Optional small-model organizer slot

`createMemoryPortraitOrganizer` in `server/src/portrait/organizer.js` is the lightweight
injected form: `writer`, `judge`, `applyPortrait`, `recordMemoryCandidate`. The old
`ingestMemory` callback is deliberately not called: an ingestion service might
auto-commit candidates. Without a writer it returns `not-configured`.

The integrated worker adds a durable queue, local gate, batching, leases and bounded
retries. Limits are configured portrait-operation limit and configured important-memory proposal limit per
batch. Ambiguity goes to one bounded Decision Model round per batch or remains pending. New or
substantially changed stable portraits always await host review; historical living/
chapter backfill also awaits review instead of becoming a false current state.
Neither writer nor Decision Model can approve canonical memory writes. A host reads exact
candidate evidence and uses its normal memory-intent tools to make that decision.

External conversation evidence must be attested by the authenticated host. Memory
evidence IDs/hashes are checked before sending and before writing, and cannot lower
source sensitivity. No automatic paid model calls start after deployment. The owner
must configure tested routes and explicitly enable processing. Hosts must submit
observations via `POST /api/portraits/observe` or `moss_profile_observe`; no host
transcript polling/integration is implemented. See `MODEL_RUNTIME.md`.

## Budgets and diagnostics

Main/background lane budgets remain separate. A combined hard ceiling applies
afterward, including room for the normal response wrapper. One whole main-lane T0
representation (existing summary, otherwise full original) may exceed the soft
budget; background never borrows this exception. Additional whole-memory upgrades
cannot also exceed it. Entries too large for the combined ceiling remain cues with
explicit expansion handles; they are never labeled as full originals. ID/hash
duplicates across lanes are suppressed.

Character limits measure compact JSON payloads in JavaScript UTF-16 code units, not model tokens, UTF-8 bytes or the full MCP transport envelope. Body-free diagnostic traces and explicitly requested originals/expansions are separate APIs, not automatically injected context. Host-side final model-request token budgets remain essential.

## Adoption checklist

- Separate canonical transcript, runtime state and compiled context.
- Exactly one replaceable Seed and at most one current profile slice per request.
- Do not store transient profiles as conversation messages.
- Route using current message plus recent topic context, not the last short utterance alone.
- Cache profile partitions by revision; compile relevant slices rather than inject the full store.
- Preserve privacy admission and use policy.
- Do not immediately duplicate bootstrap observances with a date lookup.
- Test rolling windows and append-only provider behavior before enabling a host adapter.

## Session Capsules and offline Steward

See `CAPSULES_AND_STEWARD.md` for published Capsule versions, the header-only catalog,
explicit offline batches and durable processing receipts. Live window identity,
source cursors, offline triggers and Handoff composition stay with the host.
Steward shares the existing review inbox and writes proposals only.

See [vector migration and health inspection](VECTOR_AND_HEALTH.md) for the backend migration APIs, timers, reports and host boundaries.

See [recall and navigation upgrade](RECALL_UPGRADE.md) for semantic/local routing,
host-only status, confirmed surface cooldown, Atlas leads and reviewable Lineage
partitions. These reuse the existing domain services and host delivery contract.
