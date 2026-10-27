# Docker quick start

Requires Docker Engine/Desktop with Compose v2. No host Node.js, model key or vector service is required for local recall.

```sh
git clone https://github.com/Lucien-rose/contextweave.git
cd contextweave
docker compose up --build -d --wait
docker compose exec contextweave moss doctor
```

The first image build downloads dependencies; later starts reuse the image. The service runs as the unprivileged `node` user, listens on host `127.0.0.1:2091`, and stores SQLite, encrypted model settings, the model encryption key and two generated tokens in the `moss-data` named volume. Ordinary `down`, rebuilds and restarts retain that volume. `docker compose down --volumes` deletes it; use that only to discard a disposable installation.

To connect an MCP client, retrieve the generated credentials locally:

```sh
docker compose exec contextweave moss token runtime
# Only for your separate operator client:
docker compose exec contextweave moss token admin
```

Configure agents with `http://127.0.0.1:2091/mcp/runtime` and the runtime bearer token. Configure the owner client with `/mcp/admin` and the admin token. Keep credentials private. Remote access requires your existing TLS proxy; see [Operations](OPERATIONS.md). Set `MOSS_HTTP_PORT=2092` in a local `.env` file to change the host port. Inside the container the port remains 2091.

## Import your JSON package

Place your package in the host `imports/` directory, mounted read-only as `/imports`. Existing imports retain preview-first behavior and never overwrite memories.

```sh
mkdir -p imports
# Copy your JSON memory package into imports/ before continuing.
docker compose stop contextweave
docker compose run --rm contextweave import
docker compose run --rm contextweave import --apply
docker compose up -d --wait
```

Omitting the filename discovers a single JSON file; multiple files require an explicit selection. Use `memories.json` to resolve a filename from the mount, `/imports/memories.json` for an absolute container path, or `file:///imports/memories.json` for a file URL. Host absolute paths outside the mounted directory are not container paths. The report includes the selected file, target database and record counts. A failed import exits nonzero; after resolving it, restart the service with the last command. See [Memory Import](MEMORY_IMPORT.md) for supported formats, conflict policy and snapshot restores.

## Run the complete host example

The bundled synthetic example first retrieves the imported Harbor project record, then saves and confirms a sample host message through Runtime MCP and retrieves it again. Each run adds one clearly marked sample message. Use a disposable installation for this walkthrough.

```sh
docker compose stop contextweave
docker compose run --rm contextweave import examples/host/memories.json --apply
docker compose up -d --wait
docker compose exec contextweave moss example
```

Expected final output: `PASS: imported memory recalled; host message saved and recalled through Runtime MCP.` The example uses local recall, so no paid API calls are needed.

## Diagnose an installation

```sh
docker compose exec contextweave moss doctor
docker compose exec contextweave moss doctor --json
docker compose logs --tail=100 contextweave
```

Doctor checks directory permissions, SQLite integrity, encrypted model settings, HTTP health, authenticated runtime/admin tool discovery and Qdrant connectivity when vector recall is enabled. Each failure includes a repair action; exit code is 0 only when all checks pass. Tokens and provider keys are never printed. Optional models and vectors may remain unconfigured. Provider inference is not tested and no paid model requests are sent.

If the backend cannot start, run diagnostics in a one-off container against the service address:

```sh
docker compose run --rm -e MOSS_BASE_URL=http://contextweave:2091 contextweave doctor
```

A stopped backend is expected to fail HTTP/MCP checks; local storage/config checks still run. To configure optional model/vector services, use the existing admin tools and [Vector & Health](VECTOR_AND_HEALTH.md). Persist their configuration under `/app/data/config`; separate containers must be reachable by their network hostname rather than host loopback.

For native Node installations, run `npm run doctor` with the same database, config and tokens as the backend. Set `MOSS_BASE_URL` to change its HTTP target. After importing the bundled package, run `npm run example:host`.

## Upgrade and back up

Back up the whole data volume, including `config/models.key` and `config/tokens.env`, with the backend stopped, or use the existing SQLite snapshot procedure plus a separate config backup. An export of memory records alone cannot restore settings or full history. See [Operations](OPERATIONS.md#backup-and-restore).

```sh
git pull --ff-only
docker compose up --build -d --wait
docker compose exec contextweave moss doctor
```

Container smoke CI verifies fresh startup, import, MCP write/recall and restart persistence. The five-minute target applies after Docker is available; initial download/build time depends on your network.
