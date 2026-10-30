# ContextWeave 1.4.0 — HTTP API v1 and SDK previews

Publication status: prepared release candidate. This document does not create a tag,
publish a registry package, or upgrade any existing deployment.

## Application integration

- HTTP API v1 exposes memory ingestion, recall, pinned evolution, context-checked
  reads, bootstrap, confirmed delivery, body-free change receipts and admin reviews.
- TypeScript SDK 0.1.0 preview: typed requests, Runtime/Admin clients, ESM/CommonJS
  exports, timeout/cancellation and structured API/transport errors.
- Python SDK 0.1.0 preview: synchronous/asynchronous Runtime/Admin clients, generated
  requests and paths, typed responses, connection cleanup and wheel/sdist packages.
- SDKs preserve the full response envelope and domain decisions. `review_required`
  is not a saved memory; unavailable reads stay gated. Delivery is acknowledged only
  after successful injection. Clients perform no automatic retries.
- Each deployment owns its backend address, credentials and database. The SDKs do
  not connect users to a shared hosted ContextWeave service.

## Recall corrections

Qualified T2 associations retain their fuzzy association behavior while admission
requires grounded paths and answer utility. Ordinary relevance uses 0.75 and
association path fit retains 0.8. Successful no-utility judgments may suppress
direct identity material; uncertainty and model-failure fallback retain their
documented direct-evidence behavior. No entity-name blacklist was introduced.

## Validation

- Backend integration suite: 55/55 tests.
- TypeScript SDK suite: 6/6, including independently installed tarballs and both
  ESM/CommonJS consumer declarations.
- Python SDK suite: 6/6, including wheel construction from sdist and independent
  installation; strict typing passes for 8 SDK/consumer/example files.
- Python CI covers 3.11 and 3.13; user-reported Ubuntu VPS acceptance covers 3.12.
- Architecture: 217 backend modules, zero detected cycles; release boundary checks
  pass. Container CI exercises startup, doctor, import, MCP/HTTP and restart persistence.

These are synthetic integration checks. Existing retrieval benchmarks keep their
original corpus/provider scope; this SDK release does not claim new benchmark gains.

## Installation and upgrade

Backend: Node.js 24+, or the documented Docker Compose workflow. SDK-only use:
TypeScript requires Node.js 22+; Python requires 3.11+ and HTTPX. Ubuntu repository
tests may need the matching `python3.12-venv` system package.

SDKs remain source/download previews. npm/PyPI names are provisional and their
publication guards remain in place. Downloadable packages can be installed locally.

Back up SQLite and configuration, including credentials and the model encryption
key, before upgrading an existing installation. JSON memory import is not a full
backup. There is no new database migration in this batch. Private services do not
upgrade automatically when this release is published.

## 中文说明

本次发布补齐 HTTP API v1、TypeScript 与 Python SDK 预览版，并收录召回门禁修复。
SDK 连接部署者自行指定的后端，保留审核状态、上下文权限、版本校验与送达确认。
TypeScript 支持 ESM/CommonJS；Python 提供同步、异步调用与类型提示。

后端与两份 SDK 已完成合成数据、独立安装和 CI 验证。SDK 目前通过源码或下载包试用，
不代表已上架 npm/PyPI。本次发布不会自动更新已有私人部署，也不包含新的数据库迁移。
