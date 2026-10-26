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
