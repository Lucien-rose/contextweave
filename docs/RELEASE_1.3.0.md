# ContextWeave 1.3.0

This release brings reproducible retrieval evidence, separate agent/operator MCP surfaces and a complete first-deployment workflow.

## Highlights

- Three isolated provider-backed runs on a frozen synthetic corpus of 80 events and 106 held-out questions: ContextWeave averaged 97.4% Top-1, 0.986 MRR@5 and 100% evidence recall. These are retrieval results, not answer-generation or production-user claims. See [the report](../evaluation/PROVIDER_BENCHMARK_2026-10-27.md).
- Separate `/mcp/runtime` and `/mcp/admin` endpoints and stdio commands. Runtime credentials cannot open admin or compatibility MCP. Legacy `/mcp` remains available with deprecation headers; existing admin-token installations remain compatible.
- Docker Compose runs as an unprivileged user, generates separate persistent credentials and retains SQLite/config across restarts.
- `doctor` checks storage, SQLite, model settings, HTTP/MCP and optional Qdrant connectivity, with repair instructions and no paid inference requests.
- JSON imports support mounted filenames, absolute paths, file URLs and unambiguous single-file discovery. Preview-first transactional imports preserve existing conflict and duplicate protections.
- A real host example imports a synthetic project record, saves/confirms a sample message through Runtime MCP and recalls both.
- Corrected the MCP commit handler's stale core-method reference, found by the end-to-end example.

## Validation

- 35 synthetic/local integration tests; architecture check reports zero import cycles.
- Public release-boundary, synthetic demo, shell syntax and whitespace checks.
- Container CI covers image build, fresh startup, diagnostics, import preview/apply, MCP write/recall and restart persistence, including stable token/encryption-key hashes.

## Upgrade and scope

Back up the database and configuration, including the model encryption key and credentials, before upgrading. Follow [Operations](OPERATIONS.md) or the [Docker guide](DOCKER.md). A JSON memory export alone is not a full system backup.

The release is the public memory backend. It does not update an existing private VPS automatically. Stable versioned HTTP APIs and TypeScript/Python SDKs remain planned work. Optional external model/Qdrant deployments require their own environment configuration.

中文：本版本收录三轮检索评测、运行时/管理 MCP 拆分、Docker 部署、doctor 诊断、JSON 路径识别及端到端接入示例。现有记忆与兼容入口继续保留；私人服务不会随公开发布自动升级。
