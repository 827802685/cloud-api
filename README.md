# Cloud API

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](./.nvmrc)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20D1-F38020?logo=cloudflare&logoColor=white)](#部署到-cloudflare)

可自托管的开源 AI 网关。支持多供应商模型接入、图像生成、语音转写、智能体工具（Agent Tools），通过 Cloudflare Workers + D1 实现零成本边缘部署，也支持 Docker + PostgreSQL/MySQL 自托管。

## 核心能力

1. **多供应商接入**：支持 OpenAI、Anthropic、Gemini 等主流模型厂商及自建 OpenAI-compatible 服务，内置导入模板一键接入
2. **多协议支持**：OpenAI Chat/Images/Audio、Anthropic Messages、Gemini generateContent 等
3. **智能体工具**：联网搜索、网页抓取、深度搜索，统一通过 `/v1/tools/*` 接入
4. **灵活路由策略**：hash_affinity（缓存亲和）、weighted_random（加权随机）、weight_priority（优先级主备）、weighted_round_robin（加权轮转）
5. **用户与额度管理**：外部系统、用户、API 密钥三层维度，三账本计费设计
6. **管理后台**：供应商/模型/路由可视化管理，请求日志、数据分析、调试台与模拟器
7. **边缘部署**：Cloudflare Workers + D1 免费部署，也可 Docker 自托管

## 快速开始（本地开发）

需要 **Node.js 20+**。管理后台（含 Proxy 逻辑）在**一个终端**中运行。

```bash
git clone https://github.com/827802685/cloud-api.git
cd cloud-api
npm install
npm run db:migrate
```

终端 1 — 管理后台（含 Proxy 逻辑，`:8789`）：

```bash
npm run dev:admin
```

（本地调试 Proxy 逻辑也可用 `npm run dev:proxy:node` 走 Node + SQL。）

| 服务 | 地址 | 说明 |
|------|------|------|
| 管理后台（含 Proxy 逻辑） | http://127.0.0.1:8789 | 推理入口 + 控制台；默认账号 **`admin` / `admin`** |

## 部署到 Cloudflare

本项目采用**单 Worker 二合一架构**：只部署一个 **Admin Worker**（`cloud-api-admin`），通过 GitHub Actions 自动部署到 Cloudflare。Proxy 的推理/工具 API 逻辑（`@cloud-api/proxy`）作为库被 Admin Worker 复用，不再单独部署独立 Worker。

对外 API 地址就是该 Worker 的域名，例如 `https://api.zjkl.dpdns.org/v1/chat/completions`。Admin Worker 同时处理：
- `/v1/*`（裸路径，标准 API 入口，如 `/v1/chat/completions`、`/v1/models`）
- `/api/v1/*`（兼容前缀，内部重写为 `/v1/*`）
- `/api/admin/*`（管理后台 API）

这样无论域名指向哪个 Worker，`/v1` 都能作为 API 正常使用。

### 前置准备

1. **Cloudflare 账号**：确保已开通 Workers 和 D1 服务
2. **创建 D1 数据库**：
   ```bash
   npx wrangler login
   npx wrangler d1 create cloud-api
   ```
   记录输出的 `database_id`

3. **创建 Cloudflare API Token**：前往 [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens) 创建，需包含以下权限：
   - Account → Cloudflare D1 → Edit
   - Account → Cloudflare Workers → Edit

### 配置 GitHub 仓库

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中配置：

**Variables（变量）：**

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `ADMIN_WORKER_NAME` | Admin Worker 名称 | `cloud-api-admin` |
| `D1_DATABASE_NAME` | D1 数据库名称 | `cloud-api` |
| `D1_DATABASE_ID` | D1 数据库 ID | `de9cc5da-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `D1_MIGRATIONS_WORKER_NAME` | 迁移配置名称 | `cloud-api-d1-migrations` |
| `ADMIN_CUSTOM_DOMAIN` | Admin 自定义域名（可选） | `api.example.com` |

**Secrets（密钥）：**

| 密钥名 | 说明 |
|--------|------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |

### Admin Worker 部署（GitHub Actions）

Push 到 `main` 分支时，GitHub Actions 会自动：
1. 安装依赖并生成 Wrangler 配置
2. 构建并部署 Admin Worker 到 Cloudflare

触发条件：当 `packages/admin/**`、`packages/proxy/**`、`packages/core/**`、`packages/tool-engines/**`、`scripts/deploy/**` 有变更时。

> 单 Worker 二合一：Proxy 逻辑（`@cloud-api/proxy`）作为库被 Admin Worker 复用，无需单独部署 Proxy Worker。对外 API 地址即 Admin Worker 的域名，例如 `https://api.zjkl.dpdns.org/v1/chat/completions`。

### D1 数据库迁移

当 `packages/core/migrations-d1/**` 有变更时，GitHub Actions 会自动执行数据库迁移。

### 首次部署（本地 CLI）

如果更倾向于首次部署使用本地 CLI：

```bash
# 交互式引导（推荐首次使用）
npm run bootstrap:cloudflare

# 或手动部署
npm run deploy:cloudflare -- production --migrate
```

引导脚本会依次完成：创建/复用 D1 → 写入实例配置 → 应用数据库迁移 → 构建并部署 Admin Worker（含 Proxy 逻辑）→ 设置 ADMIN_PASSWORD。

### 部署后验证

```bash
# 健康检查（Admin Worker 也暴露 /health）
curl -i "https://<your-worker>.workers.dev/health"
# 预期返回：{"status":"ok","service":"cloud-api-admin"}

# 打开管理后台
# https://<your-worker>.workers.dev
# 使用 admin / 你设置的 ADMIN_PASSWORD 登录
```

### 部署后安全初始化

| 凭据 | 用途 | 存储位置 |
|------|------|----------|
| `ADMIN_PASSWORD` | 浏览器登录管理后台 | Cloudflare Worker Secret |
| `MASTER_KEY` | 调用 `/api/admin/*` | D1 `system_config` 表 |
| 用户 API Key | 调用代理服务 `/v1/*` | D1，管理后台创建 |

首次迁移会写入开发占位值 `sk-dev-admin-key`。部署后请立即在管理后台 **系统 → 配置** 中替换 MASTER_KEY。

## 项目结构

```
cloud-api/
├── packages/
│   ├── core/           # 核心业务逻辑、数据库层、D1/Postgres/MySQL 实现
│   ├── proxy/          # Proxy 逻辑（Hono），推理/工具 API 入口；作为库被 Admin Worker 复用
│   ├── admin/          # Admin Worker（Next.js + OpenNext），管理后台 + 对外 API（含 /v1/*）
│   └── tool-engines/   # 智能体工具引擎（联网搜索、网页抓取等）
├── scripts/
│   └── deploy/         # 部署脚本（wrangler 配置生成、引导脚本等）
├── cloudflare-worker/  # Cloudflare 部署实例配置（.env 文件）
├── docker/             # Docker 部署配置
└── docs/               # 文档
```

## 常见问题

### GitHub Actions 报 "not permitted to create or approve pull requests"

前往仓库 **Settings → Actions → General → Workflow permissions**，勾选 **"Allow GitHub Actions to create and approve pull requests"**。

### 管理后台登录 401

`ADMIN_PASSWORD`（网页登录密码）与 `MASTER_KEY`（API 主密钥）不同。重设登录密码：

```bash
npx wrangler secret put ADMIN_PASSWORD --name <admin-worker-name>
```

### `/catalog/models` 返回空数组

部署正常。新数据库没有已启用的路由，请在管理后台添加供应商、模型并创建路由。

### 自定义域名部署失败

先去掉 `ADMIN_CUSTOM_DOMAIN`，用 `*.workers.dev` 地址验证通过后再绑定域名。确保域名所在 zone 已加入同一 Cloudflare 账号。

## 开源协议

本仓库使用 **GNU Affero General Public License v3.0（AGPLv3）** 授权，详见 [LICENSE](./LICENSE)。
