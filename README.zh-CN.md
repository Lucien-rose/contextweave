# ContextWeave Core

面向长期对话的自托管记忆后端。SQLite 保存权威原文；可选向量模型和 Qdrant 提供可重建的检索索引。

支持分层召回、用户画像、来源证据、Lineage 变化史、Atlas 关联导航、会话胶囊、整理提案、索引代际迁移及健康检查。前端、会话状态与提示词拼装由接入方负责。

## 本地启动

需要 Node.js 24 或更新版本。

```sh
npm ci
export MOSS_CONFIG_DIR="$PWD/data/config"
npm run init
export MOSS_ADMIN_TOKEN=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')
npm start
```

默认监听 127.0.0.1:2091。/health 不要求认证，其余 /api/ 与 /mcp 使用 owner Bearer token。远程接入请配置 TLS。本地 MCP 客户端可启动 npm run start:stdio。

无须付费模型即可使用 SQLite 基础召回。模型连接与后台整理默认不启用；填写并测试模型配置后，由所有者决定是否启用。

## 配置与接入

[配置说明](docs/CONFIGURATION.md) 中的 CW_* 是公开工程基线，可在启动前覆盖。复制 .env.example 后可使用 node --env-file=.env server/src/backend.js --http；先生成自己的令牌。API 名称中的 moss_* 与已有 MOSS_* 环境变量为兼容标识。

[工具参考](docs/TOOLS.md) 从真实 Schema 生成，包含参数类型、上下限与有效默认值。[宿主接入](docs/HOST_INTEGRATION.md) 说明上下文替换、画像路由及批处理职责；[本地 Skill 指南](docs/AGENT_INTEGRATION.md) 帮助使用者建立自己的策略。

[运维说明](docs/OPERATIONS.md) 包含安装、备份恢复和维护入口。[模型配置](docs/MODEL_RUNTIME.md) 说明协议与密钥保存。[术语](docs/TERMINOLOGY.md) 对照公开名称和兼容字段。

## 开源范围

不包含私人 Skill、真实记忆、用户画像、生产配置、私有前端或原仓库历史。此包为 1.0.0 独立部署源码；公开仓库为 [Lucien-rose/contextweave](https://github.com/Lucien-rose/contextweave)。不要直接覆盖私人部署。

后续召回评测、关系候选、召回日志与概要自动排队见[路线图](docs/ROADMAP.md)，不阻塞 1.0 使用。

## 署名与联系

Apache-2.0；Copyright 2026 Phina。由 Phina 创立，与 Lucien（OpenAI Codex）共同设计、实现、审查和打磨。完整分工见 AUTHORS.md。

[The Letterbox｜私人来信](https://important-tire-245.notion.site/7660116d784a4f61806d3ad3533207a9)。欢迎自愿分享使用经历和改良；来信不是许可证要求。邮箱自动提醒未接入。
