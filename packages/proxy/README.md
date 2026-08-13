# `@cloud-api/proxy`

**推理入口**：Cloudflare 上作为库被 **Admin Worker** 复用（**单 Worker 二合一**，见 [cloudflare.md](../../docs/operators/deployment/cloudflare.md)），或独立跑在 **Node**（Postgres / MySQL）。对外：

- `GET /`、`GET /health`
- 公开目录：`GET /catalog/models`（无需用户 Key）
- OpenAI：`POST /v1/chat/completions`、`POST /v1/images/generations`、`POST /v1/images/edits`、`POST /v1/audio/transcriptions`、`GET /v1/models`
- Anthropic：`POST /v1/messages`
- Google Gemini：`POST /v1beta/models/{model}:generateContent`（含 `streamGenerateContent`）
- Agent Tools（可扩展 `/v1/tools/*`）：
  - `web-search`：博查、Tavily、阿里云 CleverSee、腾讯云联网搜索 WSA
  - `web-fetch`：Firecrawl、Tavily Extract、Jina Reader
  - `web-deep-search`：Firecrawl Search、Jina Search

2.0 按 Request Surface → Route Pool → Upstream Target 解析路由；Pool 内以 priority 分层，同层使用 `hash_affinity`（默认）/ `weighted_random` / `weight_priority` / `weighted_round_robin` 与 weight 排序，并按 Provider 维度熔断。一个 Provider 维护一把上游 API Key。

**不提供** `/admin/*`。管理 API 由 **`@cloud-api/admin`** 在 **`/api/admin/*`** 提供。Tools 引擎 Key 与单价在 Admin → **Tools** 维护。

## 命令（在仓库根 `npm install` 后）

```bash
npm run dev:proxy          # 本地调试 Proxy 逻辑（Worker + 本地 D1）
npm run dev:proxy:node     # Node + SQL（根 `.env`）
npm run deploy:admin       # Cloudflare 生产部署：Admin Worker（含 Proxy 逻辑）
```

> Cloudflare 生产环境**不再单独部署**独立 Proxy Worker；Proxy 逻辑随 Admin Worker 一起通过 `deploy:admin` 部署。

文档：[docs/README.md](../../docs/README.md) · [route-topology.md](../../docs/developers/architecture/route-topology.md) · [local-development.md](../../docs/developers/local-development.md)
