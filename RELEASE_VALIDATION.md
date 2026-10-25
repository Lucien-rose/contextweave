# ContextWeave Core 1.0.0 validation

Validated on 2026-10-25 with Node.js 24.22.1 and npm 11.9.0.

- Public test suite: 14 passed, 0 failed. Covers authenticated HTTP/MCP operation,
  SQLite backup/restore, recall, portrait processing and configurable defaults.
- Architecture check: 203 source modules, no detected local import cycles;
  module/function size, duplicate function and version checks passed.
- MCP reference: 60 tools, generated through a real tools/list exchange.
  Change Record max_chars accepts 12000–50000; 5000 is rejected and omitting
  the field succeeds. Deployment overrides appear in the live schemas.
- Synthetic recall demonstration passed without paid providers.
- Fresh archive extraction: locked dependency installation, public tests,
  architecture/boundary checks and database/key initialization passed.
- Linux installer passed bash syntax validation. systemd deployment was not
  executed in this validation environment.
- Release review checked known private identifiers, production profiles,
  personal Skills, database artifacts and repository history. Only approved
  author credits and the public contact form are included.

The document generator uses an actual in-memory SQLite database; it does not
leave a database file in the release tree. The release boundary check recognizes
SQLite files even when they have no database extension.

This is source for a separate public deployment, not an update installer for a
private application. Existing moss_* tools, MOSS_* variables and service paths
remain compatibility identifiers. Personal configuration and original repository
history have not been copied into this archive.

Validation preceded GitHub publication. No registry package or live deployment
was published by these checks. No live
paid-provider or remote Qdrant migration was exercised. Synthetic checks do not
certify arbitrary provider behavior or replace owner acceptance on the intended
deployment platform.

## Public naming and final closure

Public tool descriptions, schema help, model instructions, errors and generated
Notion review text use the public names. API identifiers, persisted field names,
routing enums and service paths remain compatible. The 60-tool contract was
compared before/after with descriptions excluded: no structural change. Legacy
display names remain only in the explicit terminology compatibility table.

Final closure on 2026-10-25:

- Shared serialized-response counting replaces repeated assignments in Context Seed
  and delivery responses, including the legacy v2 adapter. Exact counts were checked
  across digit boundaries and confirmed-delivery receipts.
- Portrait promotion coverage uses CW_TIMEZONE rather than a fixed UTC offset;
  UTC and Asia/Taipei date boundaries were checked with synthetic events.
- Stable documentation names replace internal version-number filenames. Model
  connection, Index Generation and initialization instructions match the public backend.
- Deferred recall evaluation, relationship suggestions, Recall Ledger and automatic
  summary scheduling are listed in docs/ROADMAP.md with host/backend ownership.
- Tools were regenerated from the live 60-tool contract; local Markdown links resolve.
- The final source archive was extracted separately; npm ci installed 93 locked
  packages, all 14 tests and architecture/boundary/demo checks passed, and fresh
  database/key initialization succeeded. systemd and real providers remain untested.
