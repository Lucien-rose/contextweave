# Configuration

This distribution contains public engineering defaults, not a production deployment profile. Set environment variables before startup; restart after changing them. Request parameters override deployment defaults within tool schema limits. Persisted owner runtime settings override initial schema defaults.

| Variable | Default | Range | Purpose |
|---|---:|---|---|
| MOSS_ADMIN_TOKEN | none | at least 24 characters | Owner credential for admin MCP, compatibility MCP and legacy HTTP APIs |
| MOSS_RUNTIME_TOKEN | admin token | at least 24 characters | Least-privilege credential for runtime MCP only |
| CW_SEED_CHARS | 4096 | 2048–24000 | Context Seed response ceiling |
| CW_MAIN_CHARS | 6000 | 1200–12000 | Main recall content budget; legacy bootstrap content budget |
| CW_TOTAL_CHARS | 12000 | 2048–24000 | Combined recall response ceiling |
| CW_BACKGROUND_CHARS | 1000 | 0–4000 | Background recall content budget |
| CW_BACKGROUND_ITEMS | 1 | 0–3 | Background item ceiling |
| CW_RECALL_ITEMS | 5 | 1–12 | Recall item ceiling |
| CW_PORTRAIT_CHARS | 4000 | 512–20000 | Portrait lookup budget |
| CW_HISTORY_CHARS | 12000 | 12000–50000 | Change Record packing budget |
| CW_PORTRAIT_OPERATIONS | 3 | 1–20 | Portrait proposals per model result |
| CW_MEMORY_CANDIDATES | 2 | 1–10 | Memory/Lineage candidates per result |
| CW_LIVING_DAYS | 3 | 1–30 | Initial temporary-state duration |
| CW_EXPIRED_GRACE_DAYS | 14 | 1–365 | Cleanup delay after expiry |

Character budgets count JavaScript UTF-16 code units, not tokens. Main budget is soft for one complete direct item; combined total is hard. History budget applies to receipt packing with response overhead, not a model token allowance.

Living days sets the initial runtime duration; explicit expires_at remains authoritative. Expired grace days controls post-expiry cleanup, including rejection of late reinforcement. They are separate policies. Changing grace can clear previously expired content sooner; take a backup before reducing it.

Health installer schedules: CW_HEALTH_DAILY_SCHEDULE=daily and CW_HEALTH_WEEKLY_SCHEDULE=weekly, interpreted by systemd in the server timezone. Override at installation. Model routes, vector thresholds, batch sizes and transport timeouts use the owner APIs and existing MOSS_* variables described in MODEL_RUNTIME.md and OPERATIONS.md. MOSS_* identifiers remain supported compatibility names.

No model keys or provider routes are bundled. Runtime processing starts disabled. Do not commit local .env files.

CW_TIMEZONE defaults to UTC for calendar calculations and portrait promotion date counts. Health timers use the server timezone unless an explicit zone is supplied in their systemd schedule. Optional MOSS_RECALL_PROFILE_FILE must explicitly point to an owner-created vocabulary profile; no profile is loaded implicitly.

Health status describes the recommended daily/weekly cadence; it does not inspect installed systemd units. Use systemctl list-timers to verify the actual schedule.

`CW_JEV_MODE=off|observe|on` overrides automatic semantic recall selection. Omit it
to use the configured Decision Model by default and local recall without one.
`MOSS_RECALL_JEV_MODE` is the legacy equivalent. Task-specific model routes and
per-request cooldown settings are documented in [RECALL_UPGRADE.md](RECALL_UPGRADE.md).
