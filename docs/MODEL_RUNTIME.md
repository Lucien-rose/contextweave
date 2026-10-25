# Model connections and background portrait runtime

This release ships backend contracts, not a settings UI. All HTTP routes below
are under the existing owner-authenticated `/api/` boundary. Never put keys in a
URL, chat, client persistence, logs or a diagnostic export.

## Connections

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/models/connections` | Public configuration metadata; keys never returned |
| POST | `/api/models/connections` | Create one connection |
| PUT | `/api/models/connections/:id` | Replace unassigned connection; omit key to keep it |
| DELETE | `/api/models/connections/:id` | Delete an unassigned connection |
| POST | `/api/models/connections/:id/test` | Bounded paid probe; body `{ "capability": "generate" }` |
| GET | `/api/models/routes` | Current task routing |
| PUT | `/api/models/routes/:task` | `{ "connection_id": "..." }`; null restores env fallback |

Create/replace fields:

```json
{
  "name": "Background writer",
  "protocol": "google",
  "base_url": "https://generativelanguage.googleapis.com/v1beta",
  "model": "YOUR_SELECTED_MODEL_ID",
  "api_key": "SUBMIT_ONCE_THEN_CLEAR_CLIENT_STATE",
  "capabilities": ["generate"],
  "dimensions": null,
  "include_dimensions": true,
  "output_mode": "json_schema",
  "google_generation_api": "generate_content",
  "timeout_ms": 30000,
  "max_output_tokens": 6000
}
```

Protocol and capability are separate:

| Protocol | Base convention | Capabilities |
| --- | --- | --- |
| `openai` | Include version prefix, e.g. `https://api.openai.com/v1` | `generate`, `embedding` |
| `google` | `https://generativelanguage.googleapis.com/v1beta` | `generate`, `embedding` |
| `anthropic` | `https://api.anthropic.com/v1` | `generate` only |
| `decisions` | `https://openrouter.ai` (no `/api/v1`) | `decisions` only |

The server appends `/chat/completions`, `/embeddings`, `/messages`, Google native
model methods, or `/api/alpha/decisions`. Do not submit a full operation URL.
Google generation supports both `google_generation_api=generate_content` and
`google_generation_api=interactions`. The former remains the compatibility
default; current AI Studio projects can explicitly select `interactions` without
changing Google embedding behavior. Interaction requests are stateless and set
`store=false`.
`output_mode=json_object` is an explicit OpenAI-compatible fallback for providers
without strict schemas; results still pass the original local validation. There is
no silent protocol fallback or second provider call. Anthropic schema constraints
unsupported on the wire are expressed as descriptions and enforced locally.

Tasks: `portrait`, `summary`, `jev`, `embedding`. Decision Model may keep Decisions or use a
structured generator, but judgment authority/thresholds are unchanged. Anthropic
cannot be assigned to embeddings. Embedding dimensions must be declared and every
response is checked. Model names are owner choices, never automatically upgraded.

Saving or testing does not activate a connection. Activation requires a successful
test for its current configuration/capability. Assigned connections cannot change
semantic settings in place: create, test, then route to a replacement. Key-only
rotation is explicit and write-only. Legacy Decision Model/vector env configuration remains
the fallback when no route is assigned; existing deployments need not copy keys.

With an existing vector index, a different model/base/protocol/dimension embedding
space can be saved and tested but activation returns HTTP 409. The old space keeps
serving. Use Index Generations to build the replacement space, validate coverage,
compare recall, activate it and retain rollback coverage. See
[VECTOR_AND_HEALTH.md](VECTOR_AND_HEALTH.md). This guard also prevents route removal
from silently switching back to a different env-based space.

## Key custody and custom endpoints

`deploy/moss-backend-install.sh` initializes `/etc/moss-memory/models.key` once
and grants the service account access. `npm run init` does the same for a manual
installation under `MOSS_CONFIG_DIR` (default `data/config`), preserving existing keys. Connections are AES-256-GCM encrypted
in `/etc/moss-memory/models/connections.json`, with restricted permissions. The
master key is outside the application database. Back up it and the encrypted
configuration separately from normal memory exports; losing it loses access to
saved provider keys. Neither is included in source/release packages or HTTP memory
exports. `MOSS_MODEL_SETTINGS_FILE` / `MOSS_MODEL_KEY_FILE` override these paths.
For a fresh manual install, export the desired `MOSS_CONFIG_DIR` and run
`npm run init` before starting the backend.

A future frontend should submit keys over HTTPS only, clear its input/component
state after success, never persist them in browser storage and never request their
plaintext back. Clearing state is not a promise of secure erasure from browser
memory or developer-tools request history. The UI password lock supplements
server authentication; it does not replace it.

Custom endpoints default to HTTPS/public IPs. DNS resolution is checked at socket
connection time and redirects are not followed. A trusted administrator can set
`MOSS_MODELS_ALLOW_PRIVATE=1` in the server environment for local/HTTP models; a
web request cannot enable it. Treat any custom gateway as an additional party
receiving your private data; matching a protocol does not imply matching privacy
terms. Provider test calls use synthetic probes, never real memories.

## Network selection

Model connections accept optional `network_family`: `auto`, `ipv4` or `ipv6`.
Omitting it uses server-side `MOSS_MODELS_NETWORK_FAMILY` (default `auto`). This
applies to portrait/summary generation, Decision Model and embeddings, including legacy
Decision Model/vector env routes. Per-connection settings override the server default.

Automatic mode enables Node's alternating IPv6/IPv4 connection attempts with a
250 ms attempt interval. DNS lookup honors the requested address family and
checks every returned address using the existing public-endpoint policy. Only
connection establishment tries alternate addresses; ContextWeave never replays a POST
after receiving an HTTP response or switches models/protocols on failure.

For an IPv4-only deployment, select `network_family: "ipv4"` on its saved Google
connection before testing. Assigned configurations remain immutable; use a tested
replacement as usual. Existing connections without the new field and their test
fingerprints remain valid. Network settings do not change vector-space identity.
No system-wide IPv6 disable, firewall change or extra service privilege is needed.

Errors distinguish DNS, unreachable routes, refused connections, timeouts and
TLS failures without returning raw provider errors or credentials. A provider
HTTP 403 is a separate application-layer refusal and is not fixed by selecting
IPv4; real account/model compatibility still requires an explicit provider test.

## Worker lifecycle

| Method | Path | Purpose |
| --- | --- | --- |
| GET / PUT | `/api/portraits/runtime` | Body-free status / processing settings |
| POST | `/api/portraits/observe` | Idempotent host-attested user observation |
| POST | `/api/portraits/run` | Explicitly run one job/flush one batch, even while disabled |
| POST | `/api/portraits/backfill` | Explicit bounded memory IDs, `kind=portrait` or `summary` |
| POST | `/api/portraits/jobs/:id/retry` | Owner retries a reviewed job after fixing the cause |
| GET | `/api/portraits/candidates` | Bounded pending proposal list |
| GET / PATCH | `/api/portraits/candidates/:id` | Exact evidence / dismiss or mark handled |

Defaults: disabled; four eligible observations or five minutes before a batch;
at most eight observations/16,000 text characters per ordinary batch; one job per
30-second worker tick; one writer call and at most one Decision Model call per portrait batch.
No network call occurs for a queue-only observation. Enable with:

```json
{
  "enabled": true,
  "batch_min": 4,
  "wait_seconds": 300,
  "living_days": 3,
  "max_sensitivity": "private"
}
```

`max_sensitivity` gates both event bodies and portrait snapshots sent to providers.
Raise it explicitly to `sensitive`/`intimate` only after choosing the data recipient.
Blocked observations remain pending, visible in body-free counts; they do not leak
into less-sensitive batches. The writer receives only bounded events plus related
portrait items/headers, never the full memory archive. Observe real user messages
only; assistant messages, fiction and an explicit `hint=skip` are skipped. The
local gate only removes trivial acknowledgements; it does not pretend to infer
semantic relevance from a keyword list. A host may provide `hint=relevant`.

Observation example:

```json
{
  "event_id": "message-42",
  "session_id": "session-7",
  "role": "user",
  "scope": "real",
  "text": "The user-authored message text",
  "sensitivity": "private",
  "occurred_at": "2026-10-23T10:00:00+08:00",
  "source_refs": [{ "source_type": "conversation", "source_id": "message-42" }]
}
```

Failures retry at most three attempts with backoff; a crash lease expires after
15 minutes. Cached proposals and idempotent change/candidate IDs prevent duplicate
writes. Unknown/stale revisions, unsupported quotes, stable promotions and uncertain
judgments remain in review. Short-term reinforcement refreshes expiry for the same
episode; a new episode uses a new ID. Chapter changes require judgment and never
complete from silence. Configured operation/candidate caps are hard local validation, not just prompts.
The worker always uses silent profiles and cannot automatically expand Seed.

Memory proposals never enter the legacy auto-ingestion path. Inspect the original
evidence (`moss_profile_candidate_read`), decide with host-owned memory-intent
tools, then mark handled or dismiss (`moss_profile_candidate_close`). Marking handled
does not write anything. Decision Model cannot authorize canonical memory writes.
Candidate lists return headers only. Exact candidate reads default to 16,000
serialized characters (maximum 50,000); long source frames have offsets, truncation
markers and explicit continuation handles instead of dumping an entire transcript.

Backfill requires explicit active memory IDs (at most 20 per request). Each job is
bounded to one original (at most 50,000 characters); larger sources require a
separate explicit split. Historical short/mid-term portraits await review; they
do not become false current states. Summary backfill only fills missing recommended
summaries, leaves canonical text/lifecycle unchanged, rechecks hash/timestamp before
write and invalidates derived vectors for refresh. Original source text is data,
not executable instructions. No whole-archive bulk job starts after installation.

Resolved candidate bodies are cleared after 14 days. Completed job payloads and
processed/skipped observation copies are cleared after 30 days, preserving minimal
receipts and immutable original evidence. Pending reviews are not silently erased.

## Embedding into another host

The standalone backend initializes the schemas and owns worker startup/shutdown.
When composing the library modules in another process, `ensurePortraitSchema(db)`
creates portrait, queue and immutable source tables; `startPortraitWorker(db)`
belongs to the application's lifetime, outside the chat response path.
Default settings disable model processing until the owner enables it.
Memory-backed backfill/summary jobs additionally need the canonical `memories`,
`audit_log`, `memory_vector_jobs` and `memory_vector_state` tables owned by the host
memory service; the standalone portrait-only path needs none of those.
When integrating canonical deletion, call `purgeMemoryPortraitDerivatives` inside
the same transaction: dependent portrait bodies, pending proposals and queued/running
work are invalidated together. The standalone backend already does
this; immutable conversation evidence remains separate.

Host integration remains external. Context composition, transcript submission,
temporary slice replacement, and actual provider-cache hits still belong to the
host. This backend being ready does not mean automatic host ingestion is enabled.

## Protocol references

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Google generateContent structured output](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
- [Google embeddings](https://ai.google.dev/api/embeddings)
- [Anthropic structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)

Tests use synthetic mocked responses/local providers. Real provider/account/model
compatibility must be accepted by the owner using the explicit test endpoint.
