# ContextWeave 1.5.0 — Recall Receipts

SDK source versions: TypeScript 0.2.0 and Python 0.2.0. Python 0.2.0 is
[available on PyPI](https://pypi.org/project/contextweave-sdk/0.2.0/).

Ordinary recall now returns a durable receipt reference. The owner-only HTTP
reader shows the submitted query, selected T0/T1/T2 titles, filtered and
privacy-blocked candidates with reasons, retrieval routes, latency and package
size. Details store references and titles without copying memory bodies or the
full request/trace. Each omitted category stores up to 24 entries plus its count.

Confirmed delivery preserves its existing acknowledgement and cooldown behavior.
The host can optionally report the injected package's model-specific token count.
Both SDK admin clients expose the receipt reader; Python includes sync and async
clients. Receipt details have no MCP reader and belong outside model context.
See [contract](RECALL_RECEIPT.md).

## Upgrade

- Existing databases gain one nullable `recall_deliveries.details_json` column.
  Legacy receipts remain readable and acknowledgeable; old clients remain valid.
- Existing hourly maintenance now applies the established 30-day completed /
  90-day prepared receipt retention. Back up the database before upgrading.
- Permanent memory deletion clears the memory's title from stored receipts.
  Query text remains the submitted query; the audit does not copy memory bodies.
- Bootstrap/date recall and retrieval ranking retain their contracts. No new
  retrieval-quality benchmark claim accompanies this release.
- Eden cards, Memory cache, write-refresh and SSE synchronization remain deferred.
- GitHub publication does not update private deployments. npm remains unpublished.

## Validation

Backend and SDK integration tests cover receipt lifecycle, partial/idempotent
delivery, legacy migration, title snapshots, privacy auditing, background budget
reasons, deletion and retention. SDK packaging checks exercise independently
installed TypeScript tarballs and Python wheels; Python typing and the architecture
and public-boundary checks are included in CI. Release artifacts are built by the
Release Assets workflow and carry SHA256 checksums.

## 中文说明

本次新增召回小纸条的后端记录与查询：检索正文、分层记忆标题、淘汰与隐私拦截原因、
检索通道、延迟和记忆包大小。精确 token 数由宿主回报。详情仅向 owner/admin 开放，
由宿主在模型上下文之外读取。现有送达确认继续复用，两份 SDK 同步增加查询方法。

更新前需备份数据库与配置。本次包含兼容性数据库迁移，并接通既有保留期清理。
Eden 前端和同步留待后续接入；私人部署不会自动更新。
