# 线上部署：Cloudflare（单 Worker 二合一 + D1）

本文说明 **octafuse-gateway** 在 Cloudflare 上的运维路径：**本地 D1 开发**、**dev 演示（octafuse.dev）**、**生产 Git 自动部署**。

**外部用户首次上云**（推荐）：[cloudflare-quickstart.md](./cloudflare-quickstart.md)（`npm run bootstrap:cloudflare`）。本页不替代该 quickstart。

实例 env 文件约定：[cloudflare-worker/README.md](../../../cloudflare-worker/README.md)。表结构以 **`packages/core/migrations-d1/`** 为准。Docker 自托管见 [docker.md](./docker.md)。

> 本仓库不以 Cloudflare Deploy Button 作为主路径：官方 Deploy Button 无法一次装齐 monorepo 单 Worker 二合一 + 共享 D1。

---

## ⚠️ 本项目实际部署流程（必读）

本仓库采用**单 Worker 二合一架构**：只部署一个 **Admin Worker**（`cloud-api-admin`），通过 **GitHub Actions** 自动部署。Proxy 的推理/工具 API 逻辑（`@cloud-api/proxy`）作为库被 Admin Worker 复用，不再单独部署独立 Worker。

| 组件 | 部署方式 | 触发机制 |
|------|----------|----------|
| **Admin Worker（含 Proxy 逻辑）** | **GitHub Actions**（`.github/workflows/deploy-admin.yml`） | `git push` 到 `main`，且 `packages/admin/**`、`packages/proxy/**`、`packages/core/**`、`packages/tool-engines/**`、`scripts/deploy/**` 有变更 |
| **D1 数据库迁移** | **GitHub Actions**（`.github/workflows/deploy-migrations.yml`） | `git push` 到 `main`，且 `packages/core/migrations-d1/**` 有变更 |

对外 API 地址即 Admin Worker 的域名，例如 `https://api.zjkl.dpdns.org/v1/chat/completions`。Admin Worker 同时处理 `/v1/*`（标准 API 入口）、`/api/v1/*`（兼容前缀）与 `/api/admin/*`（管理后台 API）。

### GitHub Actions 配置要求

**Secrets**（Settings → Secrets and variables → Actions）：

| Secret | 说明 |
|--------|------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（用于部署 Worker 和执行 D1 迁移） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |

**Variables**（Settings → Secrets and variables → Actions → Variables）：

| Variable | 示例值 | 说明 |
|----------|--------|------|
| `ADMIN_WORKER_NAME` | `cloud-api-admin` | 管理后台 Worker 名称（单 Worker 二合一，含 Proxy 逻辑） |
| `D1_DATABASE_NAME` | `cloud-api` | D1 数据库逻辑名 |
| `D1_DATABASE_ID` | `3de00849-xxxx` | D1 数据库 UUID |
| `D1_MIGRATIONS_WORKER_NAME` | `cloud-api-d1-migrations` | 迁移配置名（不创建实际 Worker） |

### 日常操作流程

1. **修改代码后**：直接 `git push` 到 `main`，GitHub Actions 自动构建并部署 Admin Worker（含 Proxy 逻辑）和迁移
2. **新增数据库迁移**：将 SQL 文件放入 `packages/core/migrations-d1/`，push 后自动执行
3. **查看部署状态**：GitHub 仓库 → Actions 页面查看工作流执行情况

### 注意事项

- **不要**手动在本地执行 `npm run deploy:admin` 来部署，应通过 GitHub Actions 自动部署
- **不要**将 `D1_DATABASE_ID` 提交到 Git，它只应存在于 GitHub Variables 中
- 迁移文件必须是幂等的（使用 `IF NOT EXISTS` 等），因为 D1 不支持 `ALTER TABLE ADD COLUMN IF NOT EXISTS`
- Admin Worker 的 `ADMIN_PASSWORD` 通过 Cloudflare Worker Secrets 管理：`npx wrangler secret put ADMIN_PASSWORD --name <admin-worker-name>`

---

## 0. 配置模型（必读）

| 文件 | 角色 |
|------|------|
| `packages/*/wrangler.base.jsonc`、`packages/core/wrangler.d1.base.jsonc` | **已提交模板**（无生产 `database_id`） |
| `packages/admin/wrangler.jsonc`（含 Proxy 逻辑）、`packages/core/wrangler.d1.jsonc` | **生成产物**（`npm run gen:wrangler`，gitignore） |
| `cloudflare-worker/example.env` | **dev 演示**配置（可提交） |
| `cloudflare-worker/*.env`（除 example） | **生产/私有**（gitignore）；或仅用 Cloudflare Dashboard **Build variables** |

**两种注入方式（变量名相同）**：

| 方式 | 何时用 |
|------|--------|
| **Cloudflare Build variables** | Workers Builds · `git push` 自动部署 |
| **`dotenv -e cloudflare-worker/xxx.env`** | 本地 CLI：`deploy:*`、`db:migrate:remote` |

`gen-wrangler` 只读 `process.env`，不读 Git 里的 env 文件（CI 构建时 Build variables 即 env）。

---

## 1. 本地 Cloudflare 开发

本机 Worker、不上线；步骤见 [users/quickstart.md](../../users/quickstart.md) §1。远程 deploy 后继续本地 dev 前须 `npm run gen:wrangler`，详见 [local-development.md §1](../../developers/local-development.md#️-本地-d1-与-database_id远程-deploy-后必读)。

---

## 2. dev 演示部署（example.env · octafuse.dev）

长期公共测试环境，配置见 [`cloudflare-worker/example.env`](../../../cloudflare-worker/example.env)：

| 角色 | 域名 | Worker |
|------|------|--------|
| 代理服务（Proxy） | `https://test-api.octafuse.dev` | `octafuse-gateway-proxy-dev` |
| 管理后台（Admin） | `https://test-admin.octafuse.dev` | `octafuse-gateway-admin-dev` |
| D1 | — | `octafuse-gateway-dev` |

**首次（CLI）**：

```bash
npx wrangler d1 create octafuse-gateway-dev
# 更新 example.env 中 D1_DATABASE_ID
npx dotenv -e ./cloudflare-worker/example.env -- npm run db:migrate:remote
npx dotenv -e ./cloudflare-worker/example.env -- npm run deploy:admin
```

dev 演示**仅 CLI 发版**（有新 SQL 时先 `db:migrate:remote`）；生产 Connect to Git 见下方 §4。

下游测试变量：`GATEWAY_URL` / `GATEWAY_MASTER_URL` / `GATEWAY_MASTER_KEY`（见 [integration.md](../../developers/integration.md)）。

---

## 3. 生产部署

**同一仓库代码、多实例**：每个 Worker 一套 **Build variables**；**勿**把生产 `D1_DATABASE_ID` 提交进 Git。

| 场景 | Worker / D1 命名 | 自定义域 |
|------|------------------|----------|
| 默认生产（示例） | `cloud-api-admin`，D1 `cloud-api` | 常见为 Cloudflare Dashboard 绑定，wrangler 不写 `routes` |
| 自有 fork / 第二实例 | 自定 Worker 名与 D1 名，避免与同账号其它实例冲突 | 可选 `ADMIN_CUSTOM_DOMAIN` |

> **单 Worker 二合一**：只部署一个 Admin Worker（含 Proxy 逻辑）。对外 API 地址即该 Worker 的域名，例如 `https://api.zjkl.dpdns.org/v1/chat/completions`。

本地 CLI：复制 [`example.env`](../../../cloudflare-worker/example.env) 为 gitignore 的 `cloudflare-worker/<name>.env`，填生产值后 `dotenv -e ... deploy:admin`（与 Build variables 同名同值）。首次也可直接用 [cloudflare-quickstart.md](./cloudflare-quickstart.md)。

### 环境变量（Build variables / 本地 `.env`）

| 变量 | 说明 |
|------|------|
| `ADMIN_WORKER_NAME` | **须与 Cloudflare Dashboard 中的 Worker 名一致**（单 Worker 二合一，含 Proxy 逻辑） |
| `D1_DATABASE_NAME` | D1 逻辑名 |
| `D1_DATABASE_ID` | 远程 deploy / migrate **必填**。写入生成的 `wrangler.jsonc` 后，本机 `dev:admin` 会连**另一套**本地 D1；继续本地开发前执行 `npm run gen:wrangler`（见 [local-development.md §1](../../developers/local-development.md#️-本地-d1-与-database_id远程-deploy-后必读)） |
| `D1_MIGRATIONS_WORKER_NAME` | 可选；仅 `wrangler d1 migrations` 配置名，**无需建 Worker** |
| `ADMIN_CUSTOM_DOMAIN` | 可选 |

---

## 4. 部署（GitHub Actions）

单 Worker 二合一架构下，**Admin Worker（含 Proxy 逻辑）通过 GitHub Actions 自动部署**，无需 Cloudflare Connect to Git / Workers Builds。Worker 名须与 `ADMIN_WORKER_NAME` 一致（[Workers name requirement](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/#workers-name-requirement)）。

### Build variables

在 GitHub Actions **Variables** 填入 §3 上表变量（`D1_DATABASE_ID` 只放 GitHub Variables，不进 Git）。

| 变量 | 必填 | 说明 |
|------|------|------|
| `ADMIN_WORKER_NAME` | ✅ | 管理后台 Worker 名（单 Worker 二合一，含 Proxy 逻辑） |
| `D1_DATABASE_NAME` | ✅ | D1 逻辑名 |
| `D1_DATABASE_ID` | ✅ | `npx wrangler d1 list`；**只放 GitHub Variables** |
| `D1_MIGRATIONS_WORKER_NAME` | 可选 | 仅迁移脚本配置名 |
| `ADMIN_CUSTOM_DOMAIN` | 可选 | 写入 wrangler `routes` |

### 构建 / 部署命令

**勿**在本地手动跑 `npm run deploy:admin`——CI（`.github/workflows/deploy-admin.yml`）已拆分 build 与 deploy。

| Worker | Build command | Deploy command |
|--------|---------------|----------------|
| **Admin（含 Proxy）** | `npm ci && npm run gen:wrangler && npm run build:cf -w @cloud-api/admin` | `cd packages/admin && npx opennextjs-cloudflare deploy` |

说明：

- `npm ci` → `postinstall` → `gen:wrangler` 会读 **GitHub Variables** 生成 `wrangler.jsonc`。
- **D1 迁移不在 Git 流水线**：有新 SQL 时手动 `npm run db:migrate:remote`（带实例 env 或 export 变量）后再 push。
- **Admin Worker**：`ADMIN_PASSWORD` 用 Worker **Secrets**（`npx wrangler secret put ADMIN_PASSWORD --name <ADMIN_WORKER_NAME>`）。
- 可选：`WRANGLER_SEND_METRICS=false`。

### 本地 CLI（与 CI 相同生成逻辑）

```bash
npm run deploy:cloudflare -- <instance> --migrate   # 推荐
# 或手动：
npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run gen:wrangler -- --remote
npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run db:migrate:remote
npx dotenv -e ./cloudflare-worker/<instance>.env -- npm run deploy:admin
```

---

## 5. 首次创建 D1

```bash
npx wrangler login
npx wrangler d1 create octafuse-gateway-dev   # 或你的生产 D1 名
npx wrangler d1 list
```

将 **`D1_DATABASE_ID`** 写入 Build variables 或 gitignore 的 `cloudflare-worker/<name>.env`。外部首次上云优先用 [cloudflare-quickstart.md](./cloudflare-quickstart.md)（脚本会创建或复用 D1）。

---

## 6. 迁移与发布顺序

**本项目已通过 GitHub Actions 自动执行迁移**：push 到 `main` 时，如果 `packages/core/migrations-d1/` 有变更，`deploy-migrations.yml` 会自动应用新迁移。

手动迁移（仅在 GitHub Actions 不可用或紧急情况下使用）：

```bash
npx dotenv -e ./cloudflare-worker/<x>.env -- npm run db:migrate:remote
```

先迁移、再发依赖新 schema 的 Worker。迁移文件必须幂等（见注意事项）。

---

## 7. 认证与下游

- 管理 API Bearer 须与 D1 **`system_config.MASTER_KEY`** 一致（见 [api/admin.md](../../developers/api/admin.md)）。
- 下游门户：`GATEWAY_URL`（对外 API 地址，即 Admin Worker 域名，如 `https://api.zjkl.dpdns.org`）、`GATEWAY_MASTER_URL`（管理后台）、`GATEWAY_MASTER_KEY`（见 [integration.md](../../developers/integration.md)）。

---

## 8. 健康检查

- 对外 API（Admin Worker 暴露）：`GET /health`
- 管理后台：首页、浏览器登录，以及携带 `MASTER_KEY` 的 `GET /api/admin/config`
- D1 迁移：`npx wrangler d1 execute <name> --remote --config packages/core/wrangler.d1.jsonc --command 'SELECT COUNT(*) AS applied FROM d1_migrations;'`
- 日志：`npx wrangler tail`（Worker 名见 GitHub Variables）

### Workers Free 的 3 MiB 体积限制

Cloudflare Workers Free 的单 Worker gzip 上限为 **3 MiB**。管理后台依赖 **`@opennextjs/cloudflare@1.19.4+`**（未使用 `ImageResponse` / `opengraph-image` 时不再误打包 `@vercel/og` / `resvg.wasm`）。部署输出的 `Total Upload ... gzip` 应低于套餐上限。若仍超限，检查是否误引入 OG 路由或过大依赖。若免费额度余量吃紧或流量上来，也推荐升级 [Workers Paid](https://developers.cloudflare.com/workers/platform/pricing/)（约 $5/月）——量大管饱，性价比极高。

管理后台的 `wrangler.base.jsonc` 设置了 **`NEXT_PRIVATE_MINIMAL_MODE=1`**：本应用无 Next `middleware.ts`，用以避开 Workerd 上 `getMiddlewareManifest()` 动态 `require` 导致的全站 500（上游 [opennextjs-cloudflare#1232](https://github.com/opennextjs/opennextjs-cloudflare/issues/1232)）。若日后引入 middleware，需等上游正式修复后再去掉该变量。

---

## 9. 多实例与灰度

同一 Cloudflare 账号可跑多套 Worker（不同 `ADMIN_WORKER_NAME` / `D1_DATABASE_ID`）。升级 **gen-wrangler** 或迁移流程时，建议：

1. 先在 staging 验证变更。
2. 再更新生产 Worker 的 GitHub Variables。
3. 有新 D1 SQL：**先** `db:migrate:remote`（对应实例 env），**再**部署依赖新 schema 的 Worker。

### 回滚

GitHub Actions 部署历史 / Cloudflare Dashboard Worker 版本 **Rollback**。

---

## 10. 下游 fork

若维护独立部署 fork，生产绑定（`D1_DATABASE_ID`、Worker 名、域名）应放在各 fork 的 **Build variables** 或 gitignore env 中，**勿**在 Git 里提交真实 `wrangler.jsonc`。merge upstream 时无需保留旧的 committed `database_id`。

---

**相关**：[cloudflare-worker/README.md](../../../cloudflare-worker/README.md) · [部署索引](./README.md) · [local-development.md](../../developers/local-development.md)
