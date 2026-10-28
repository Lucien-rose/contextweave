# Association evidence in recall

Association discovery stays permissive: a weak or paraphrased cue may find a
seed, and the seed can lead to a useful T2 memory without being delivered itself.
The discovery thresholds, seed count and expansion budget are unchanged.

Before delivery, each association-only candidate receives two additional Jev
judgments:

- `path_fit`: `coherent`, `broken` or `uncertain` for the query → seed → candidate connection.
- `answer_utility`: `material`, `background`, `none` or `uncertain` for the candidate's contribution to this response.

The request-local `association_context` includes a permitted seed excerpt,
lexical match terms, FTS rank, vector qualification, entity discovery status,
and the existing association bridge. These are discovery signals, not factual
authority. They are included in the existing 24-candidate, 12,000-character Jev
snapshot budget. No database migration, persistent relation or additional model
request is needed. Seed revisions invalidate in-flight judgments just as
candidate revisions do.

A coherent path with material utility may enter the main lane as T2. Coherent
background context uses the separate background lane. Broken, uncertain and
unjudged paths are omitted. Jev may omit the intermediate seed while retaining a
useful successor; literal query overlap at the successor is not required.

When Jev is off, unavailable, incomplete or fails, association-only candidates
are not delivered. Local T0/T1 recall and association discovery still run. The
trace reports `association-path-unjudged` for withheld candidates. Explicit
observe mode likewise keeps unjudged associations out of delivery; shadow
diagnostics can compare proposed judgments without recording recall.

Candidate traces contain body-free `association_judgment` fields and suppression
reasons. Seed snippets and matched terms remain confined to the bounded model
snapshot; they are not added to public recall projections or trace output.

`server/test/public-association.test.js` exercises hidden-seed T2 delivery,
accidental lexical matches, answer utility, background budgets, model failure,
seed revisions and the provider contract with deterministic judgments. These
tests validate the contract and enforcement. Real-provider replay is still
required to measure semantic accuracy and latency before production rollout.
