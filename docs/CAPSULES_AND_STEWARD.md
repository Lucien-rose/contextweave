# Session Capsules and offline Steward

## Responsibility boundary

The host owns its live window registry, valid conversation messages, offline
triggers, per-window source cursor, target-window selection and context assembly.
ContextWeave stores published Capsule versions and processes explicit offline batches.
Its Capsule catalog is only a synchronized catalog of published material, not a
live window directory. Unfinished items are part of a Capsule. Handoff is
a temporary host projection, not another durable ContextWeave record. Existing handoff,
scene-capsule and sync contracts remain unchanged; no automatic migration or
loading of the globally newest capsule occurs.

## Session Capsules

All HTTP operations use the existing owner authentication:

| Method | Path | Meaning |
| --- | --- | --- |
| POST | `/api/window-capsules/organize` | Optional summary-model preview, never publishes |
| POST | `/api/window-capsules/publish` | Publish an explicit host-approved version |
| GET | `/api/window-capsules/catalog` | Latest published headers, paged |
| POST | `/api/window-capsules/read` | Read an exact capsule ID, including older versions |

MCP exposes `moss_window_capsules` and `moss_window_capsule_read` only for reading.
No model writes a published capsule automatically. Organizer uses the existing
`summary` route and the configured portrait-runtime sensitivity ceiling; it sends
only the submitted message slice. It returns data, exact evidence references,
sensitivity and `published=false`. It is an explicit paid call, not a background
poller. Organizing again is another call; the host should reuse its preview.

Organizer input is the shared batch envelope below, without `batch_id` or
`memory_ids`. Publish input:

```json
{
  "change_id": "publish-window-7-r12",
  "window_id": "window-7",
  "source_surface": "my-host",
  "session_id": "session-7",
  "source_revision": 12,
  "expected_version": 0,
  "sensitivity": "private",
  "data": {
    "title": "Release preparation",
    "summary": "The release is ready for review.",
    "decisions": ["Review before deployment"],
    "open_items": [{"id":"review", "text":"Review release", "status":"open"}]
  },
  "source_refs": [{"source_type":"conversation", "source_id":"message-42"}]
}
```

The first version expects zero; later versions expect the current ContextWeave version
and a strictly newer host source revision. Window identity is scoped by surface;
a window keeps its session identity. Repeated identical change IDs return the
original receipt; different content under that ID is a conflict. Original source
contexts become evidence references rather than copied transcript bodies in the
capsule. Catalog entries include IDs, title, version and read handles, never body,
decisions or unfinished-item text. `limit` defaults to 20 (max 50), with `offset`.
Private access is required; intimate capsules additionally require proactive/scene
mode for both catalog and exact read. These records do not enter ordinary recall
or Context Seed automatically. They remain explicit published records, like other
curated archives, not short-lived handoff tails.

## Steward batches

| Method | Path | Meaning |
| --- | --- | --- |
| POST | `/api/doctor/batches` | Idempotently submit one host-selected batch |
| POST | `/api/doctor/run` | Process at most one ready Steward job |
| GET | `/api/doctor/batches/:batch_id` | Body-free status and durable processing receipt |
| POST | `/api/doctor/batches/:batch_id/retry` | Retry a reviewed batch after correcting the cause |

```json
{
  "batch_id": "offline-session7-r12-part1",
  "subject_id": "user",
  "source_surface": "my-host",
  "session_id": "session-7",
  "source_revision": 12,
  "memory_ids": [],
  "events": [{
    "event_id": "message-42",
    "subject_id": "user",
    "session_id": "session-7",
    "role": "user",
    "scope": "real",
    "text": "Let us review the release tomorrow.",
    "sensitivity": "private",
    "occurred_at": "2026-10-24T12:00:00+08:00",
    "source_refs": [{"source_type":"conversation", "source_id":"message-42"}]
  }]
}
```

Events must be unique real messages from one subject/session in host order.
Submit at most 64 messages/64,000 text characters (and within the owner HTTP body
limit). Larger nightly work is split by the host, with stable distinct batch IDs.
Assistant messages may support shared-event memory proposals but cannot establish
user portrait facts. Original conversation frames use existing immutable evidence
storage. Derived memory records are comparison targets, not conversation events.

Steward uses the existing portrait writer route and sensitivity ceiling. Its
comparison snapshot includes query-matched portraits and up to 20 host-selected
active memory IDs (16,000 serialized characters of memory context). Long memory
context uses its existing summary or a marked excerpt, at most 3,000 characters;
permitted latest Lineage change explanations are included. The receipt identifies
which IDs were actually compared. This is bounded coverage, not a whole-archive
semantic audit; the host selects missing or relevant comparison targets.

Every output remains a proposal in the existing portrait candidate inbox:
maximum configured portrait-operation limit, and the configured combined memory/Lineage proposal limit.
Exact event quotations are checked; Lineage targets must belong to the supplied
snapshot. Snapshot revisions/hashes remain visible for host review. Steward writes
no portrait, stable trait, promotion, canonical memory or Lineage transition.
Read sources with the existing candidate reader, inspect the current target,
use the official profile/memory-intent tools separately, and then close the
candidate as handled/dismissed. Closing does not execute a proposal.

Steward jobs reuse existing queue leases (15 minutes), cached proposals, bounded
three-attempt retries and review status. Ordinary portrait ticks never claim
Steward jobs. There is no new offline detector, timer or host transcript poller:
the host explicitly invokes `run` when offline work is appropriate. Disabling the
ordinary portrait worker does not forbid an explicitly requested Steward run.
A missing model leaves the batch pending without a provider call.

A receipt records host surface/session/source revision and first/last event IDs.
It is not a ContextWeave-owned source cursor. Only `status=done` returns
`host_may_advance_cursor=true`; the host persists its own progress after reading
that receipt. This means analysis completed, not that the proposals were approved
or written. Failed/leased/reviewed batches never authorize progress. Replaying a
batch ID does not enqueue another job; changed payload under the same ID is a
conflict. Use a new batch ID after host edits or branch changes.

Body-free processing receipts persist independently of the existing 30-day job
payload cleanup. Candidate bodies follow the existing resolved-after-14-days
policy; pending reviews are not erased. Existing canonical-memory deletion
invalidates jobs/candidates that reference selected memory IDs through the shared
queue/inbox. Original conversation evidence remains an independent source.

## Public integration and deferred work

Initialize `ensurePortraitSchema`, `ensureFamilyHistorySchema`,
`ensureWindowCapsuleSchema` and `ensureDoctorSchema` on the host database. Steward
comparison additionally uses the host's canonical memories schema. The standalone backend initializes these schemas automatically. Library hosts
can initialize them explicitly when composing the domain modules. Owner exports
include the Capsule and Steward receipt tables; normal SQLite backup includes them.

Network family selection and precise model connection failures are documented in
`MODEL_RUNTIME.md`. Provider HTTP 503 is reported as provider unavailable/busy,
not reinterpreted as a local network error. No automatic provider/model fallback
or new retry layer is added to transport.

Live ingestion, window selection, Handoff projection and offline scheduling
require a host adapter. Index generations and daily/weekly health inspection are
included in this distribution; see VECTOR_AND_HEALTH.md. Semantic Steward
analysis and local health inspection are separate responsibilities.
