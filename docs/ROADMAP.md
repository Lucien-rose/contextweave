# Follow-up work

These items are deferred improvements, not requirements to operate the current release.
No release date is promised.

| Area | Backend responsibility | Host responsibility |
| --- | --- | --- |
| Recall Receipt (backend delivered) | Body-free query, titled references, routes and delivery outcomes; see [contract](RECALL_RECEIPT.md) | Reply association, Memory cache and folded visualization; synchronization remains deferred |
| Background repetition policy | Future background-specific cooldown policy | Stable surface identifiers and context placement |
| Recall evaluation | Fixed synthetic relevance cases, ranking metrics and replay through the production pipeline | Optional useful/wrong/missed feedback |
| Summary scheduling (optional) | Existing explicit backfill remains available; automatic scheduling is deferred because long T0 recall now opens relevant windows | Configure a summary model if desired |
| Relationship curation | Extend bounded Atlas structural leads and Lineage plans after evaluation | Review UI and acceptance |
| Steward coordination | Process bounded batches and return durable receipts | Conversation cursors, batch selection and offline scheduling |

Automatic relation creation, semantic merges and portrait promotion are not
implied by these plans. Source evidence and canonical write authority stay explicit.

Delivered in this upgrade: ordinary semantic recall with local fallback, confirmed
surface cooldown, relevant T0 windows, independent judgment routes, Atlas discovery
and Lineage review plans. See [contracts](RECALL_UPGRADE.md). Evaluation-corpus work
remains deferred; synthetic regressions are not retrieval-quality benchmarks.
