# ContextWeave Core

A self-hosted memory backend for long-running conversations. SQLite is the source
of truth; optional embeddings and Qdrant provide a rebuildable search index.
ContextWeave supplies recall, evidence, versioned Lineages, portraits, continuity,
Session Capsules, review proposals, Atlas navigation and Steward maintenance APIs.

This package runs independently. It contains no chat frontend, personal archive,
private application, account credentials or prefilled user portrait.

## Start locally

Use Node.js 24 LTS. From the extracted backend directory:

```sh
npm ci
export MOSS_CONFIG_DIR="$PWD/data/config"
npm run init
export MOSS_ADMIN_TOKEN=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')
npm start
```

The HTTP server binds to `127.0.0.1:2091`. `/health` is unauthenticated and returns
only health/version. `/mcp` and every `/api/` endpoint require
`Authorization: Bearer <MOSS_ADMIN_TOKEN>`. Store the token in your service
configuration for subsequent restarts. Use a TLS reverse proxy for remote access.

For a local MCP host, `npm run start:stdio` uses process transport without an HTTP
token. The host launches the process with its own working directory and configuration.

`npm test` runs synthetic integration checks; `npm run demo` demonstrates recall.
Neither needs a paid model. Plain SQLite recall works before optional models are configured.

## Deploy and operate

Place the public backend in `/opt/moss-memory`, then run
`sudo bash deploy/moss-backend-install.sh`. The installer creates the `moss` account,
owner token, encrypted model-key storage, backend service and daily/weekly health timers.
It expects Node/npm and systemd to be installed. It does not install a reverse proxy
or Qdrant. See [operations](docs/OPERATIONS.md) for model configuration, backup,
restore, upgrades and optional vector scheduling.

## Integrate a host

- [API entrypoints](docs/API.md): owner HTTP and MCP contracts.
- [Host responsibilities](docs/HOST_INTEGRATION.md): session state, context placement and profile routing.
- [Model runtime](docs/MODEL_RUNTIME.md): provider protocols, route selection and key handling.
- [Architecture](docs/ARCHITECTURE.md): module ownership and extension boundaries.
- [Public boundary](docs/public-boundary.md): exact export scope.
- [Follow-up work](docs/ROADMAP.md): backend/host boundaries for deferred improvements.

The host submits selected conversation signals/batches. ContextWeave does not read an
entire host chat archive on its own. Small-model processing starts only after
configuration and an explicit run or runtime enablement. Canonical memory proposals
remain reviewable; the background writer does not silently commit them.

## Release

[中文说明](README.zh-CN.md) · [Configuration](docs/CONFIGURATION.md) · [Tools](docs/TOOLS.md) · [Terminology](docs/TERMINOLOGY.md) · [Local agent policy](docs/AGENT_INTEGRATION.md)

Apache-2.0. Copyright 2026 Phina. Created by Phina in collaboration with Lucien (OpenAI Codex). See AUTHORS.md and THIRD_PARTY_NOTICES.md.

[The Letterbox — share your ContextWeave story privately](https://important-tire-245.notion.site/7660116d784a4f61806d3ad3533207a9). Sharing is voluntary and is not a license condition. Bug reports belong in repository Issues once the repository is published.

Source repository: [Lucien-rose/contextweave](https://github.com/Lucien-rose/contextweave). See RELEASE_NOTES.md for release scope. Existing moss_* tool names, MOSS_* variables and service paths are retained for compatibility. Fresh users configure their own identity, policies and providers.

See [the recall and navigation upgrade](docs/RECALL_UPGRADE.md) for the current
semantic routing, delivery confirmation and review-plan contracts.
