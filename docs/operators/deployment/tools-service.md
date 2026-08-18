# 部署 Tools Service（独立工具引擎服务）

> 作用：将 CPU 密集 / 长耗时的 Agent 工具（web-search、web-fetch、web-deep-search、ai-detection）从 Gateway Proxy（Workers 时尤其重要，受边缘 CPU 预算限制）中剥离，委托给独立、无状态、可横向扩展的服务执行。参见 [runtime-data.md](../../developers/architecture/runtime-data.md)「工具服务分离」。

**拓扑前提**：无论 Proxy 是 Cloudflare Worker（模式 A）还是 Node（模式 B/C），都可在 Proxy 侧配置 `TOOLS_SERVICE_URL` 将工具委托出去。Proxy 负责 Key 鉴权与 `chargeToolUsage` 计费；工具服务只执行引擎调用并返回结果。

## 1. 推荐的部署形态（Node 外部服务器）

工具负载最理想运行在有充足 CPU 时长的 Node 进程（容器 / VPS / K8s）。服务端口默认 `8899`，无数据库、无状态，可多副本横向扩展。

### Docker（独立镜像）

```bash
# 在仓库根构建
docker build -f Dockerfile.tools -t cloud-api-tools:latest .

# 运行
docker run -d --name gateway-tools -p 8899:8899 \
  -e PORT=8899 \
  -e TOOLS_SERVICE_TOKEN=your-shared-secret \
  cloud-api-tools:latest
```

### Docker Compose（与 Proxy 拼接）

[`docker/compose/node-pg.yml`](../../../docker/compose/node-pg.yml) 已含 `tools-service` 服务，并在 `gateway-proxy` 为其设置 `TOOLS_SERVICE_URL=http://tools-service:8899`。可用 Compose 变量覆盖：

```bash
TOOLS_SERVICE_TOKEN=your-shared-secret \
docker compose -f docker/compose/node-pg.yml up -d postgres tools-service gateway-proxy gateway-admin
```

### Node 直接运行

```bash
# 本地开发（源码，tsx）
npm run build:tools && npm run dev:tools:node

# 生成式产物运行
npm run build:tools
PORT=8899 TOOLS_SERVICE_TOKEN=your-shared-secret node packages/tools-service/dist/runtime/node.js
```

## 2. 备选：Cloudflare 边缘（Worker / Pages Functions）

工具服务亦可部署在 Cloudflare 边缘，将负载从网关 Worker 的 CPU 预算移走，但仍留在边缘。推荐 **Pages Functions**（独立资源 / 域名预算），备选独立 Worker。

### 2a. Cloudflare Pages Functions（推荐）

构建会生成 `dist/pages/_worker.js`（advanced mode，`export default { fetch }`）与静态占位 `dist/pages/index.html`。用 `wrangler pages` 部署：

```bash
npm run build:tools
npm run deploy:pages -w @cloud-api/tools-service   # = wrangler pages deploy dist/pages --project-name cloud-api-tools --branch main
```

- 首次运行会要求关联账户 / 创建 `cloud-api-tools` 项目；之后可反复部署同一项目。
- 在 Cloudflare 控制台为该项目绑定自定义域名，把该域名作为 Proxy 的 `TOOLS_SERVICE_URL`。

设置环境变量（令牌）：

```bash
# 用 wrangler 为 Pages 项目设置 secret（生产）
npx wrangler pages secret put TOOLS_SERVICE_TOKEN --project-name cloud-api-tools
# 或 .dev.vars（本地开发）在 packages/tools-service 下：TOOLS_SERVICE_TOKEN=...
```

> 说明：`deploy:pages` 只做 `pages deploy`，不隐式调用 `build`。请先 `npm run build:tools`（或一级脚本）再部署。

### 2b. Cloudflare Worker（备选）

```bash
npm run build:tools
npm run deploy -w @cloud-api/tools-service
```

> 说明：Workers 与 Pages Functions 同属 Cloudflare 边缘运行时，CPU 预算相近。两者相对外部 Node 服务器仍偏紧；轻量工具可用边缘形态（图省事、免运维），重度 / 高并发 / 长耗时的工具负载请优先用 Node 外部服务器（第 1 节）。

## 3. 配置 Proxy 委托

Proxy 通过以下环境变量（Workers 里为 `wrangler` `vars` / binding）启用委托：

| 变量 | 说明 |
|------|------|
| `TOOLS_SERVICE_URL` | 工具服务基址，例如 `http://127.0.0.1:8899`、`http://gateway-tools:8899` 或 `https://tools.example.com`。**必填以启用委托**；留空则 Proxy 内联执行（向后兼容）。 |
| `TOOLS_SERVICE_TOKEN` | 可选内部令牌。Proxy 与工具服务两端**都**设置且相同，则请求携带 `Authorization: Bearer <token>`。任一端缺失即不校验。 |

Cloudflare Worker 场景在 `packages/admin/wrangler.base.jsonc`（或经 `gen:wrangler` 生成的 `packages/admin/wrangler.jsonc`，Proxy 逻辑内嵌于 Admin Worker）的 `vars` 里添加：

```jsonc
"vars": {
  "TOOLS_SERVICE_URL": "https://tools.example.com",
  "TOOLS_SERVICE_TOKEN": "your-shared-secret"
}
```

## 4. 配置说明与安全

- **鉴权 / 计费在 Proxy**：工具服务不做用户 Key 校验、不读 `system_config` 计费；引擎 provider 与凭证由 Proxy 读取配置后经请求体透传。因此 `system_config`（Admin → Tools → Configuration）仍是唯一真源，凭证只存在于数据库，不落到工具服务环境变量。
- **内网部署建议**：工具服务默认不校验调用方。建议仅暴露在内网/VPC；跨公网务必设置 `TOOLS_SERVICE_TOKEN`（两端一致）。
- **无状态**：可多副本、可重启，不持有会话或库存状态。

## 5. 验证

```bash
# 健康检查
curl -s http://127.0.0.1:8899/health
# => {"ok":true,"service":"tools-service","version":"2.3.0"}

# 委托链路：经 Proxy 调用 web-search（若已配置 TOOLS_SERVICE_URL）
curl -s -X POST http://127.0.0.1:8787/v1/tools/web-search \
  -H "Authorization: Bearer sk-your-key" -H "Content-Type: application/json" \
  -d '{"query":"Octafuse"}'

# 直接验证工具服务（供调试）：缺 apiKey 返回 400，说明路由已就位
curl -s -X POST http://127.0.0.1:8899/v1/tools/web-search \
  -H "Content-Type: application/json" -d '{"provider":"tavily","query":"hi"}'
# => 400 {"error":"apiKey is required"}
```

## 6. 端点一览（内部，仅供 Proxy 调用）

| 方法 / 路径 | 引擎 | 关键请求体字段 |
|-------------|------|----------------|
| `POST /v1/tools/web-search` | search | `provider`、`apiKey`、`query`、`count`、`allowed_domains`、`blocked_domains` |
| `POST /v1/tools/web-fetch` | fetch | `provider`、`apiKey`、`url` |
| `POST /v1/tools/web-deep-search` | deep search | `provider`、`apiKey`、`query`、`count` |
| `POST /v1/tools/ai-detection` | ai detection | `provider`、`text`、`secretId`、`secretKey`、`region`、`bizType` |
| `GET /health` | — | — |

这些端点设计为内部接口：应仅由 Proxy 调用，不要在公网直接暴露（需用 `TOOLS_SERVICE_TOKEN` 保护）。