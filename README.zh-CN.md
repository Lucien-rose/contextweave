# ContextWeave

**面向 AI Agent 的长期记忆基础设施。**

[![CI](https://github.com/Lucien-rose/contextweave/actions/workflows/ci.yml/badge.svg)](https://github.com/Lucien-rose/contextweave/actions/workflows/ci.yml)
![Core](https://img.shields.io/badge/Core-1.2.0-234f46)
![Node](https://img.shields.io/badge/Node-%E2%89%A524-339933?logo=node.js&logoColor=white)
[![License](https://img.shields.io/badge/License-Apache--2.0-234f46)](LICENSE)

[English](README.md) · **简体中文**

---

> **AI Agent 可以记住一场对话。**  
> **ContextWeave 希望让它记住更长的人生。**

ContextWeave 是面向长期运行 AI Agent 的自托管记忆后端，帮助它们在不同会话、模型和应用之间维持上下文连续性。

它不把记忆简单处理成一堆静态文本块，而是保存**能够演化、能够追溯来源、能够选择性召回的记录**。权威存储与可选检索索引彼此分离，让 Agent 可以回到相关原文，而不必每次都把完整聊天历史重新塞进 Prompt。

ContextWeave 是后端，不是完整的聊天前端。接入方负责决定写入哪些内容、何时召回，以及如何放置返回的上下文。

## 为什么需要 ContextWeave？

当 Agent 运行得足够久，普通聊天历史和简单的向量搜索很快会遇到更复杂的问题。

一个偏好后来改变了。两件相似的事件需要并列存在。一段很长的原文里只有一句与当前问题有关。新窗口需要接过上一轮尚未完成的事情。某条摘要仍在，却已经找不到最初的证据。

ContextWeave 围绕四个原则设计：

**记忆应该能够演化。** 修正、并列、共存与可审核的 Lineage 历史都有明确记录，不会默默覆盖过去。

**召回应当有所选择。** 直接证据优先，辅助与背景记忆受到预算约束；没有相关记忆时可以返回空结果。长记忆也可以直接打开相关原文窗口。

**记忆应该能够追溯。** 来源证据、变化回执和渐进导航，让简短的召回线索仍然能够返回权威记录。

**连续性不应该随会话结束。** 画像、Session Capsule 与宿主管理的交接信息，让有价值的上下文跨窗口延续，而无需重放完整档案。

## 核心能力

| 领域 | 能力 |
| --- | --- |
| **渐进式召回** | 直接、辅助和关联召回；独立上下文预算；可选向量检索与语义判断。 |
| **来源证据** | 权威记录、相关原文窗口、来源引用与可检查的溯源信息。 |
| **Lineage 与生命周期** | 修正、并列、Family 分支、变化回执、审核提案与删除处理。 |
| **用户画像** | 长期、中期与短期信息分层，分别管理生命周期与有限后台处理。 |
| **Atlas 导航** | 只读关系线索、实体、关系与证据路径。 |
| **会话连续性** | Session Capsule、连续性检查点与紧凑的跨窗口交接。 |
| **维护与健康** | 离线 Steward 批处理、日检与周检、备份及索引迁移和回滚。 |
| **可迁移性** | Owner JSON 导出、事务化记忆包导入与权威数据库快照。 |

可选模型可以协助处理模糊召回、画像和维护工作，但 SQLite 基础召回不依赖模型。模型服务故障也不应该导致权威记忆被静默改写。

## 架构

```text
                        Host / AI Agent
                              |
                         MCP / HTTP
                              |
                     +--------v--------+
                     |   ContextWeave  |
                     |                 |
                     | Recall / Lineage|
                     | Portrait / Atlas|
                     | Capsule / Health|
                     +-----+-----+-----+
                           |     |
                       权威源    派生索引
                           |     |
                        SQLite  Qdrant
                                  |
                               Embedding
```

**SQLite 是权威源。** Qdrant 与 Embedding 属于可选、可重建的派生检索设施。对话输入、会话状态、Prompt 拼装、上下文放置和前端表现仍由宿主负责。

详见 [架构说明](docs/ARCHITECTURE.md) 与 [宿主接入](docs/HOST_INTEGRATION.md)。

## 快速开始

需要 **Node.js 24+** 和 npm。基础召回无需付费模型，也不要求安装 Qdrant。

```sh
git clone https://github.com/Lucien-rose/contextweave.git
cd contextweave
npm ci

export MOSS_CONFIG_DIR="$PWD/data/config"
npm run init
export MOSS_ADMIN_TOKEN=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')
npm start
```

HTTP 默认监听 `127.0.0.1:2091`。`GET /health` 无需认证，仅返回健康状态和版本；所有 `/api/` 与 `/mcp` 接口均要求 `Authorization: Bearer <MOSS_ADMIN_TOKEN>`。请安全保存令牌供重启使用；远程访问需要 TLS。

本地 MCP 进程接入：

```sh
npm run start:stdio
```

运行合成数据 Demo 与集成测试：

```sh
npm run demo
npm test
```

## 部署后如何导入已有记忆？

ContextWeave 支持从本地 JSON 记忆包导入数据。导入前可以先执行**只读预检**，查看新增、重复、冲突和无效记录的数量，再决定是否写入。已有权威记忆不会被悄悄覆盖。

示例 `memories.json`：

```json
{
  "format": "contextweave-memory-package",
  "version": 1,
  "memories": [
    {
      "title": "旅行偏好",
      "content": "喜欢安静的旅行，每天不超过两个主要地点。",
      "kind": "preference",
      "tags": ["旅行"]
    }
  ]
}
```

在已初始化的本地实例中运行；正式导入前先停止正在写数据库的后端进程：

```sh
# 只读预检，不修改数据库。
npm run memory:import -- ./memories.json --db ./data/moss-memory.sqlite

# 检查结果并完成数据库备份后，再执行正式导入。
npm run memory:import -- ./memories.json --db ./data/moss-memory.sqlite --apply
```

默认情况下，只要存在冲突或无效记录，正式导入就会整体拒绝写入。确认预检报告后，可使用 `--apply --skip-problems` 仅导入安全的新记录。向量同步任务会进入队列，之后按配置执行。

**通过 systemd 部署**的用户应使用 `moss` 服务账户和实际部署数据库路径。完整的文件复制、停止服务、备份、预检、导入、重启流程见 [记忆包导入指南](docs/MEMORY_IMPORT.md)。

**记忆包导入不等于整库恢复。** Owner JSON 导出可以作为部分记忆记录和证据摘录的导入来源；完整 Lineage 历史、画像、来源原文、连续性状态和删除墓碑仍需通过[数据库快照恢复](docs/OPERATIONS.md#backup-and-restore)保留。记忆包包含私人数据，请勿公开上传。

## 部署与运维

Linux/systemd 环境下，将公开发行版放在 `/opt/moss-memory`，然后运行：

```sh
sudo bash deploy/moss-backend-install.sh
```

安装脚本创建服务账户、Owner Token、加密模型密钥存储、后端服务和健康检查定时器。它不会自动安装反向代理或 Qdrant。配置、备份恢复和升级详见 [运维说明](docs/OPERATIONS.md)。

## 可选模型与向量召回

ContextWeave 可以仅依靠 SQLite 工作。语义判断、Embedding 与 Qdrant 需要显式配置和测试，模型路由与凭证独立管理，密钥加密存储。

详见 [模型运行时](docs/MODEL_RUNTIME.md)、[配置说明](docs/CONFIGURATION.md) 和 [向量与健康检查](docs/VECTOR_AND_HEALTH.md)。

## 宿主如何接入？

ContextWeave 不会自动读取宿主的完整聊天档案。宿主负责提交选定的对话信号或批次、决定召回时机、在适当情况下确认投递，并把返回的信息放进模型上下文。

`moss_*` 工具名与 `MOSS_*` 环境变量等兼容标识继续保留。

详见 [API](docs/API.md)、[宿主接入](docs/HOST_INTEGRATION.md)、[Agent 接入指南](docs/AGENT_INTEGRATION.md) 与根据真实 Schema 生成的 [工具参考](docs/TOOLS.md)。配置覆盖后以实时 `tools/list` 为准。

## 文档

| 文档 | 内容 |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | 架构边界与模块职责 |
| [API](docs/API.md) | HTTP 与 MCP 接口 |
| [Memory Import](docs/MEMORY_IMPORT.md) | JSON 记忆包、预检与正式导入 |
| [Operations](docs/OPERATIONS.md) | 安装、备份、恢复与升级 |
| [Configuration](docs/CONFIGURATION.md) | 运行参数 |
| [Model Runtime](docs/MODEL_RUNTIME.md) | 模型协议、路由与加密凭证 |
| [Lineage & Promotion](docs/LINEAGE_AND_PROMOTION.md) | 记忆演化与审核机制 |
| [Capsules & Steward](docs/CAPSULES_AND_STEWARD.md) | 会话连续性与离线处理 |
| [Recall Upgrade](docs/RECALL_UPGRADE.md) | 语义判断、投递与导航 |
| [Vector & Health](docs/VECTOR_AND_HEALTH.md) | 索引代际与健康状态 |
| [Public Boundary](docs/public-boundary.md) | 开源包的准确边界 |
| [Roadmap](docs/ROADMAP.md) | 后续规划 |

## 开源边界

这是可独立部署的公开后端发行版，不包含真实个人记忆、预填充画像、私有前端与应用代码、私人 Skill、生产凭证、部署密钥或原始私人仓库历史。

详见 [开源边界](docs/public-boundary.md)。当前 Core 版本为 **1.2.0**；[版本说明](RELEASE_NOTES.md) 记录发布范围，[发布验收](RELEASE_VALIDATION.md) 记录验证情况。

## 许可证与署名

使用 [Apache-2.0](LICENSE)。Copyright © 2026 Phina。

由 **Phina** 创立，**Lucien（OpenAI Codex）** 作为 AI 工程协作者参与架构、实现、审查、测试与文档整理。完整分工和第三方说明见 [AUTHORS.md](AUTHORS.md) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## The Letterbox

如果 ContextWeave 最后成为了你所创造的一部分，欢迎[悄悄寄回它后来的故事](https://important-tire-245.notion.site/7660116d784a4f61806d3ad3533207a9)。分享完全自愿，不是许可证要求。可复现的 Bug 和技术问题请提交至 GitHub Issues。
