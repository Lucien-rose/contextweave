# Lineage changes and portrait promotion

## Lineage receipts

`moss_family_history` and owner-authenticated `POST /api/evolution/family/history`
share `readFamilyHistory`. Input: `family_key`, optional `change_id`, `limit`
(1–50, default 20), `before_sequence`, `max_chars` (12,000–50,000, deployment-configured default),
`context`, `intimacy_mode`. Results are newest-first; pass `next_before_sequence`
for older receipts. General context returns no private history. Intimate receipts
require intimate context or proactive/scene mode.

`family_change_receipts` holds operation/status, difference, qualified cause,
before/after IDs and evidence references, never copies of historical bodies or
summaries. Ordinary recall does not load it. Use IDs with existing memory readers
(existing summary for long memories, body for short ones), then Source Context.

Hosts can supply `change_explanation` on memory intents:

```json
{"changed":"Coffee and milk tea preferences now coexist","reason":null,"reason_kind":"unknown"}
```

`explicit` means a user-stated cause; `inferred` is host interpretation, not a
quote/proven cause. `unknown` requires null. Omission preserves old callers and
records only operation/unknown cause. Create, reinforce, coexist, supersede,
correct, append_episode, draft activation, editor save, restore and undo record
history transactionally. Editor/restore without explanation remain unknown.
Undo marks the original receipt undone and records a transition. Permanent
deletion redacts affected explanations/evidence. Operational receipts still
expire at 60 days; durable Lineage receipts do not.

Upgrade idempotently imports surviving journal snapshots as ID-only references
with unknown causes. Already purged journals cannot be reconstructed. Older
Lineage nodes remain navigable: absent receipts do not mean no past changes.
No paid backfill occurs. Initialize with `ensureFamilyHistorySchema(db)` when
using the standalone public module.

## Portrait promotion

Existing writer output remains capped at the configured operation/candidate limits.
Moving an existing living item to chapter/stable, or chapter to stable, creates a
`promotion` candidate even if Decision Model approves. No automatic promotion occurs.
Same item revision/proposed data merges pending evidence rather than duplicating
one candidate per job. Stable new items remain review-only, too.

Host-attested observation metadata provides unique event/session/date counts and
first/last timestamps. Dates use CW_TIMEZONE (UTC by default). These are coverage signals, never
eligibility thresholds. Backfilled memories do not manufacture conversation
sessions; legacy unknown provenance contributes no invented counts. The sample
is bounded to the latest 64 source references, not exhaustive lifetime history.

Use existing candidate list/read/close tools and owner endpoints. Exact source
reads remain bounded with continuation. The host inspects evidence and current
revision, calls `moss_profile_update` separately if justified, then closes the
candidate. Closing alone changes no portrait or memory. Existing canonical
deletion invalidates dependent proposals. Repeated observation is reinforcement;
semantic sameness still belongs to the writer/judge, not string hashing.

## Decision Model and integration scope

Decision Model remains diagnostic shadow-only. Useful+no supporting snippet becomes uncertain.
Uncertain/missing judgments retain baseline eligibility in simulated selection;
explicit irrelevant affects only that candidate. Ordinary results are unchanged.
Explicit no_recall still short-circuits. Mixed-answer/none tests and the existing
indirect recall benchmark establish routing, not real-provider semantic quality.

Host conversation ingestion and context placement remain outside this backend.
Session Capsules and offline Steward are documented in CAPSULES_AND_STEWARD.md;
index generations and health inspection are documented in VECTOR_AND_HEALTH.md.
Installation does not enable disabled model workers or make paid provider calls.

See [recall and navigation upgrade](RECALL_UPGRADE.md) for semantic/local routing,
host-only status, confirmed surface cooldown, Atlas leads and reviewable Lineage
partitions. These reuse the existing domain services and host delivery contract.
