# Memory package import (v1)

ContextWeave can import **memory records** from a local JSON package into an initialized SQLite database. This is not a database restore and does not replace the destination database.

## Package format

Save UTF-8 JSON (maximum 20 MiB, 10,000 memories per package):

```json
{
  "format": "contextweave-memory-package",
  "version": 1,
  "memories": [
    {
      "id": "example:tea",
      "title": "Tea preference",
      "content": "Prefers jasmine tea.",
      "kind": "preference",
      "importance": 72,
      "event_date": "2026-10-26",
      "tags": ["tea"],
      "source_refs": [
        {
          "source_type": "conversation",
          "source_id": "message:42",
          "excerpt": "I prefer jasmine tea."
        }
      ]
    }
  ]
}
```

`id` and `title` are optional. Missing IDs are derived deterministically from title, content, kind and event date; missing titles use a short content excerpt. A top-level JSON array or an object containing `memories` also works. Owner `/api/export` JSON can be inspected/imported **only as a partial memory import**; it is not a full round-trip restore.

Supported fields include content, title, ID, kind, event date, tags, triggers, importance, layer, sensitivity, recall projections, family key, and evidence excerpts. Imported source references are reconstructed without reusing foreign `material_id` values. Source material bodies, portraits, Lineage history, supersession links, continuity state, tombstones, and external index generations are **not** imported by this command. Records with `supersedes_id`, unsupported statuses, or non-initial version history are rejected as invalid. Use [database snapshot restore](OPERATIONS.md#backup-and-restore) for an authoritative full restore.

## Local import

Initialize ContextWeave first (`npm run init`). Stop any process writing to the database before applying an import, and make a verified backup.

```sh
# Read-only preview: counts new, duplicate, conflicting and invalid records.
npm run memory:import -- ./memories.json --db ./data/moss-memory.sqlite

# After reviewing the preview and backing up the database:
npm run memory:import -- ./memories.json --db ./data/moss-memory.sqlite --apply
```

If the package contains conflicts or invalid records, `--apply` refuses **all** writes. After reviewing the preview, `--apply --skip-problems` explicitly imports only safe new records. Existing IDs and deleted IDs are never overwritten or reused. Identical imports are idempotent. Every apply runs in one SQLite transaction; memory writes update local search projections and queue vector indexing work.

The preview is read-only, including on a populated database. It does not start model providers or require API keys.

## After systemd deployment

The default installer uses `/opt/moss-memory/data/moss-memory.sqlite` and the `moss` service account. Copy the JSON file into a private readable location first. Run from the installed release directory:

```sh
sudo install -o moss -g moss -m 600 ./memories.json /opt/moss-memory/data/import.json
sudo systemctl stop moss-backend.service moss-backend-health-daily.timer moss-backend-health-weekly.timer

# Choose a NEW backup path each time.
sudo -u moss node /opt/moss-memory/scripts/database-backup.js backup \
  /opt/moss-memory/data/moss-memory.sqlite /opt/moss-memory/data/before-import.sqlite
sudo -u moss node /opt/moss-memory/scripts/database-backup.js verify \
  /opt/moss-memory/data/before-import.sqlite

sudo -u moss node /opt/moss-memory/scripts/import-memory-package.js \
  /opt/moss-memory/data/import.json --db /opt/moss-memory/data/moss-memory.sqlite

# Run only after checking the preview.
sudo -u moss node /opt/moss-memory/scripts/import-memory-package.js \
  /opt/moss-memory/data/import.json --db /opt/moss-memory/data/moss-memory.sqlite --apply

sudo systemctl start moss-backend.service moss-backend-health-daily.timer moss-backend-health-weekly.timer
```

If the installer was customized, substitute your actual database, service and config paths. After import, check `/health`, read a known imported memory, and run your configured vector synchronization if vector search is enabled. The imported JSON contains private data: keep it out of Git, restrict file permissions, and delete temporary copies when finished.

## Preview example

```json
{
  "mode": "dry-run",
  "total": 4,
  "new": 2,
  "duplicates": 1,
  "conflicts": 1,
  "invalid": 0,
  "issues": [
    { "index": 3, "id": "example:old", "type": "conflicts", "reason": "ID already belongs to a different memory" }
  ],
  "warnings": []
}
```

Only the first 100 issues are listed; counts include the full package. Memory bodies are not printed in preview reports.

## Safety and limitations

- Only the local owner should execute imports. This CLI does not expose a public upload endpoint.
- A dry-run is advisory. The apply operation re-checks the database **inside** its write transaction to avoid stale previews.
- This command is append-only. Conflicts must be resolved by editing the package or by explicit existing memory workflows; it never silently replaces canonical records.
- Imported records receive an audit entry and a new family change receipt. Historical receipts from other systems are not synthesized.
- Vector indexing is queued, not automatically completed during import.

## Docker and automatic path discovery

The CLI accepts absolute paths, working-directory paths, `file:` URLs and filenames relative to `MOSS_IMPORT_DIR`. Without a filename it selects exactly one JSON file from the working/import directories, excluding npm manifests. Ambiguous matches require an explicit path. Docker mounts host `imports/` at `/imports` and configures that search directory automatically.

See the [Docker guide](DOCKER.md#import-your-json-package) for the stop/preview/apply/restart sequence. The existing transaction, conflict and duplicate rules above apply unchanged.
