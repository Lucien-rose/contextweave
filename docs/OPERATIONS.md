# Operations

## Configuration

Node 24 LTS is the supported deployment runtime. The public HTTP service defaults
to loopback port 2091. `MOSS_HTTP_HOST`, `MOSS_HTTP_PORT`, `MOSS_DB_PATH` and
`MOSS_ADMIN_TOKEN` selects the owner credential for admin MCP, compatibility MCP and legacy owner APIs. `MOSS_RUNTIME_TOKEN` optionally supplies a distinct least-privilege credential for `/mcp/runtime`; it falls back to the admin token when omitted. New remote deployments should configure both.

`MOSS_CONFIG_DIR` selects configuration storage. Public server startup defaults to
`data/config`; export `MOSS_CONFIG_DIR="$PWD/data/config"` for local maintenance commands
to use the same configuration. The systemd installer uses `/etc/moss-memory`. `MOSS_MODEL_SETTINGS_FILE`
and `MOSS_MODEL_KEY_FILE` can override the encrypted connection file and its key.
`npm run init` creates only missing storage/key material and preserves existing keys.
Never replace `models.key` during an upgrade: it also decrypts retained vector generations.

Configure model connections through `/api/models/connections`, test the selected
capability, then assign `/api/models/routes/{portrait|summary|jev|embedding}`.
OA-compatible, Google and Anthropic generation protocols are supported. Embedding
protocols are OA-compatible and Google; protocol selection does not imply that a
provider offers every capability. See `MODEL_RUNTIME.md` for full fields.

For optional Qdrant, keep the service private and configure `MOSS_QDRANT_URL`,
`MOSS_EMBEDDING_*` and `MOSS_RECALL_VECTOR_MODE` in the service environment or the
existing `MOSS_VECTOR_ENV_FILE`. No vector provider is required for local recall.
Use `npm run vector:sync` for bounded indexing. Schedule the same command with your
service environment if desired; blue/green keeps separate saved model identities
and credentials. See `VECTOR_AND_HEALTH.md` for migration commands and guarantees.

## Backup and restore

A JSON owner export is useful for inspection and portability. A database snapshot
is the authoritative restore mechanism. To snapshot a running database consistently:

```sh
node scripts/database-backup.js backup data/moss-memory.sqlite /secure-backups/moss.sqlite
node scripts/database-backup.js verify /secure-backups/moss.sqlite
node scripts/database-backup.js restore /secure-backups/moss.sqlite /restore-test/moss.sqlite
```

Destinations must be new paths; restore never overwrites a live database. Verify
and open the restored copy in isolation before cutover. Stop the backend and its
workers/timers before replacing the live path; keep the old database and its WAL/SHM
files together. Start the service with the restored database, check `/health`,
read a known memory and inspect portrait/Lineage state. Do not enable paid workers
in the restore environment unless explicitly testing them.

Back up configuration and the corresponding `models.key` separately with restricted
permissions. A database alone cannot decrypt saved vector configurations. Qdrant
is derived but should be snapshotted as well if exact rollback of a migration is
required; otherwise rebuild from canonical memories after selecting a usable model.
Hosts that store separate assets must back those up independently. Public packages
contain no production data or secrets.

## Import portable memory packages\n\nUse `npm run memory:import -- FILE.json --db DATABASE` for a read-only preview, then stop writers, take a verified snapshot and rerun with `--apply`. Existing memories are never overwritten. This is not a full restore; see [Memory Import](MEMORY_IMPORT.md) for JSON format, conflicts and the systemd workflow.\n\n## Updates and rollback

For the standalone public service: stop `moss-backend.service` and its timers and
any separately scheduled vector/worker jobs; preserve the database/configuration;
install the new package into a fresh directory with `npm ci`; validate it against
a copy; switch the code directory and restart. If acceptance fails, restore both
the previous code directory and its pre-update database/configuration snapshot.
Run `node scripts/check-upgrade.js /path/to/previous-release` before distribution.
Do not substitute an old binary opening a new schema for an actual backup rollback.

## Health and background work

The installer enables configurable daily/weekly checks in the server timezone, with up to
five minutes jitter. Daily checks cover lightweight integrity and queue/index gaps;
weekly checks cover the larger integrity/reference checks. Findings persist until
a later applicable check resolves them. Inspection never rewrites memory content.
Disabled vector recall does not trigger network probes for an unconfigured Qdrant.

Housekeeping expires temporary portraits, purges them after the agreed grace period,
and prunes operational receipts. It is separate from semantic Steward work. The host
owns conversation cursors, batch selection and idle-time scheduling. Steward owns
bounded processing and a durable result receipt for the batch the host submitted.
