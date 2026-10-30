# Unreleased integration validation — 2026-10-30

- Backend public suite: 55/55 synthetic integration tests passed.
- TypeScript SDK: 6/6 tests passed, including a fresh standalone tarball install,
  ESM/CommonJS consumers, confirmed delivery, domain states and transport failures.
- Python SDK: 6/6 tests passed, including a wheel built from the sdist, independent
  installation, sync/async HTTP parity, native cancellation and domain states.
- Strict Python typing: 8 SDK/consumer/example files passed.
- Architecture: 217 backend modules, zero detected import cycles. SDKs import no
  backend runtime modules; backend imports are confined to repository test fixtures.
- CI also runs Python 3.11 and 3.13. User-reported VPS acceptance completed both
  SDK suites; Ubuntu Python 3.12 first required its matching venv system package.
- Public boundary scan passed. All test records are synthetic; paid model routes
  are disabled. Tests use disposable databases, not the private VPS database.

Review scope: SDK transport boundaries, generated contracts, package contents,
resource cleanup, error propagation and shared HTTP/MCP behavior. No new retrieval
benchmark was run for this SDK batch. Existing benchmark results retain their
original corpus/provider scope. Versions and publication remain release-preparation
work; successful tests do not imply that npm/PyPI packages have been published.

---

# ContextWeave 1.2.0 — release validation

Validated 2026-10-26 with GitHub Actions / Node.js 24 using synthetic data.

- Public suite: **31/31 passed** (includes 8 memory-package tests: preview, idempotency, evidence, conflicts, atomic blocking, CLI, privacy drift, invalid dates, cross-ID review, and parallel episode branches).
- Architecture: **210 source modules, 0 import cycles**, version authority clean.
- Public boundary scan: passed.
- Synthetic demo: passed.
- Install verification: `npm ci` passed.
- [CI run](https://github.com/Lucien-rose/contextweave/actions/runs/40313479686): success.

Import is local CLI only. A read-only preview never writes; apply rechecks under one SQLite transaction. Conflicting or invalid packages are rejected unless explicitly skipped, and existing IDs are never overwritten. Imported source references preserve supported evidence excerpts without reusing foreign material IDs. Historical Lineages, portraits, full source materials, continuity and tombstones remain snapshot-restore territory.

These tests use synthetic records. Real third-party provider availability, live host frontend integration and deployment-specific backup/restore rehearsal are not claimed here.

---

# Upgrade validation

Validated 2026-10-26 with Node.js 24.22.1 / npm 11.9.0 using synthetic data.

- Public suite: 23 tests, including real authenticated HTTP/MCP status separation,
  snapshot restore, scope confirmation, semantic omission/fallback, background
  admission, uncertain-candidate abstention, active snapshot coverage, exact
  long-text windows, model-route isolation and navigation plans.
- Architecture: 209 source modules; no detected local import cycles. Existing
  module/function size, duplicate-body and version-authority checks pass.
- MCP reference: 62 tools, generated from real tools/list. New tools are
  moss_relation_discover and moss_family_plan. Legacy names remain compatible.
- Public boundary scan passes. No personal Skills, private application assets,
  production database, provider key or private parameter preset is included.
- Shared changes were applied to both public Core and the private assembly;
  private deployment presets are not copied into this package.

Synthetic tests exercise provider outcomes without paid external requests. Real
provider/account availability for the public deployment and the host UI remain
deployment work. The shared semantic core passed private deployment acceptance with
an active Decision Model: an unrelated knowledge query returned `NO_RECALL` without
fallback, while an explicit release-memory query retained its T0 direct match.
This package does not deploy or update a host frontend.

Upgrade rehearsal from the previous public release passed: canonical record,
unchanged tables, added delivery scope, pending vector jobs, snapshot restore,
recall and previous-release reopening.
