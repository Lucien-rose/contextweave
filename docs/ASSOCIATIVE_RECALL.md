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
snapshot budget in the original release. The current planner deduplicates seeds
and uses short request-local candidate IDs. Each typed question carries its own
semantic criteria. Ordinary candidates receive relevance and answer-utility
questions; association-only candidates also receive a path-fit question.
Context appropriateness remains a separate question when required. Priority and
reason are derived locally, and evidence references stay pinned to input snippets.
Selected relevance, answer-utility and context-fit choices must have probability
at least 0.75 (`admissionProbability`). Association path-fit choices retain the
stricter 0.8 minimum (`associationProbability`); lower-confidence choices become
uncertain. These defaults come from a bounded production calibration sample and
are not a universal accuracy guarantee.
It budgets the serialized state and questions together, up to 24 candidates and
12,000 characters per batch, at most three sequential batches per recall.
No database migration or persistent relation is needed. Seed revisions invalidate in-flight judgments just as
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

The planner schedules final local return candidates and association-only paths before
optional exploratory records. Preliminary local admission alone does not require
another batch. Optional records fill existing batches, ordered by local eligibility
and discovery relevance within each discovery channel. Coverage includes both groups. Required candidates
that cannot fit are reported in `deferred_ids`; successful partial runs report
`jev_status: partial`, not a complete judgment. Only judged indirect candidates
compete in semantic delivery; a provider failure still uses the local fallback.
Ordinary past-event references keep active records and vector discovery in scope.
The old-state suppression rule applies only to the existing old-state intent,
not to every historical reference. Explicit version queries retain their original
current/historical/comparison state scopes.

Host `temporal.state_scope` describes event time, not memory revisions. Historical
event scope includes active and superseded records while retaining discovery channels;
it does not grant superseded records current factual authority. The independent
`temporal.version_scope` selects active, superseded or all revisions. Explicit raw
old-version intent takes precedence over inferred host fields.
