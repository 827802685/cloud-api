# Admin 配置指南

本页按“部署好以后要做什么”的顺序组织。它不替代 API 文档，只帮助使用者在 Admin 中建立可用配置。

## 1. 先确认实例边界

| 项目 | 说明 |
|------|------|
| Proxy URL | 客户端实际调用地址，例如 `http://localhost:8787` 或 `https://gateway.example.com`。 |
| Admin URL | 管理控制台地址，例如 `http://localhost:8789` 或 `https://gateway-admin.example.com`。 |
| Admin 登录 | 只用于打开管理 UI。 |
| MASTER_KEY | 管理 API Bearer，用于外部系统调用 `/api/admin/*`。生产必须轮换开发默认值。 |
| 用户 API Key | 发给客户端调用 Proxy 的 Key，不应与 MASTER_KEY 混用。 |

## 2. 配置 Provider

Provider 表示一个上游模型入口。**一个 Provider = 一把上游 API Key + 启用状态**（`active` / `disabled`）。

配置时重点检查：

- 上游 Base URL / `endpoints` 与协议类型是否匹配。
- 上游 API Key 是否真实可用（列表为脱敏；明文经 Admin「显示」或 `GET /api/admin/providers/:id/api-key`）。
- Provider `status` 是否为 **active**（disabled 或空密钥的行不会参与调度）。
- 如使用导入模板，导入后须补齐真实 API Key（导入占位 key 会标为 pending）。

需要同一供应商多账号时：创建**多个 Provider**（各一把 key），再在模型下挂多条 Route——不要期望「一个 Provider 多把 key」。

Provider 导入模板的维护说明见 [developers/reference/provider-import-presets.md](../developers/reference/provider-import-presets.md)。

## 3. 配置模型与 Route

Route 决定客户端请求的模型 ID 如何转到上游。

常见做法：

- 对客户端暴露稳定的模型名，例如 `gpt-4.1`、`claude-sonnet` 或团队内部命名。
- 同一模型下配置多个 Provider 路由：
  - **`priority`（层）**：数字**越大**越先试（硬序）。
  - **`weight`（同层）**：配合全局 / 模型路由策略（默认 **affinity**）决定层内顺序。
  - **`route_group`**：如 `default` / `free`，客户端用 `modelId:group` 选择。
- 图片生成模型：导入或手建后确认 `output_modalities` 含 `image`、`pricing_profile` 的 `image_billing_mode`（`token` / `per_image`），并挂 **OpenAI 协议** active 路由；细节见 [developers/reference/image-models.md](../developers/reference/image-models.md)。
- 语音转写模型：导入或手建后确认 `pricing_profile.audio_billing_mode`（`per_second` / `token`）与对应单价块，并挂 **OpenAI 协议** active 路由；细节见 [developers/api/user.md「语音转写」](../developers/api/user.md#语音转写audio-transcriptions)。
- **路由策略**：Admin → Config 设全局 **`ROUTE_STRATEGY`**（推荐 `affinity`，利于 prompt cache）；需要时在模型上设 **`route_policy`**（可按协议 / capability × route group 覆盖）。四种策略说明见 [developers/reference/route-strategies.md](../developers/reference/route-strategies.md)。
- 在 Route 上配置默认参数，例如思考参数、输出长度或供应商扩展字段。
- 设置价格口径：先维护模型**目录标准价**，再在路由上设用户计费 / 供应成本的基础倍率；如需对齐供应商高峰 / 闲时价，再配置 **Daily schedule**（每日时段倍率，时区见系统配置的业务时区）。
- 在请求日志中核对三笔账：供应成本、目录标准价、用户计费是否符合业务预期。

Route 默认参数合并规则见 [developers/api/user.md](../developers/api/user.md#route-默认参数合并)；时段调价契约见 [developers/api/admin.md](../developers/api/admin.md) 中的 `price_override.schedule`；调度与熔断见 [developers/architecture/proxy-request-lifecycle.md](../developers/architecture/proxy-request-lifecycle.md)。

## 4. 配置 Agent Tools（可选）

Agent Tools 是 Proxy 上面向 Agent 的 **可扩展产品 API**（`/v1/tools/*`），**不是** Chat Completions 的一部分。当前已接入联网类工具，后续可继续扩展。在 Admin → **Tools → Configuration**：

- 为当前已支持的工具（如 Web Search / Web Fetch / Web Deep Search）分别维护引擎 catalog（API Key + 单价）。
- 每种工具只选 **一个 Active** 引擎；未配置 Key 的引擎不可激活，调用时返回 **503**。
- 成功按次扣用户预算；上游失败不扣费。调用记录见 **Tools → Invocations**（与 Request Logs 同源）。

字段与引擎白名单见 [developers/api/user.md](../developers/api/user.md) 中各 Tools 章节。

## 5. 创建用户与 API Key

用户 API Key 是客户端真正使用的凭证。

建议：

- 为不同人、团队、客户或项目创建独立用户或独立 Key。
- 给 Key 设置可识别名称和 metadata，方便后续审计。
- 为用户设置预算与周期重置策略。
- 停用不再需要的 Key，而不是长期共享一把 Key。

用户、Key、预算和审计的数据模型见 [developers/architecture/user-keys-data-model.md](../developers/architecture/user-keys-data-model.md)。

## 6. 验证调用

最小验证：

```bash
curl -sS http://localhost:8787/health
curl -sS http://localhost:8787/catalog/models
```

用户推理、Images、Audio、Tools 与各协议客户端示例见 [connect-clients.md](./connect-clients.md)；完整 API 字段见 [developers/api/user.md](../developers/api/user.md)。

预算状态验证：

```bash
curl -sS http://localhost:8787/v1/me \
  -H "Authorization: Bearer sk-your-api-key"
```

## 7. 日常观察

日常排障优先看：

- 请求日志：是否命中正确模型、Provider、Route；`provider_key_*` 现为 provider id / name / key 指纹；Tools 行为 `model_id` 形如 `tool:web-search`。
- 错误状态：401 多半是认证问题；403 常见于预算或配额；502 多与路由或上游有关；全部上游熔断时可能为网关 **429**；Tools 未配置 Active Key 时为 **503**。
- 成本字段：区分 **供应成本**、**目录标准价**、**用户计费**（日志 / API 字段分别为 `metered_cost`、`standard_cost`、`charged_cost`）；Images / Audio 另见 `billing_kind`（及 image count / `audio_duration_seconds` 等列）。
- 审计日志：确认预算扣减、周期重置、Key 生命周期等事件。

更细的日志和计费语义见 [developers/reference/streaming-billing.md](../developers/reference/streaming-billing.md)、[developers/reference/image-models.md](../developers/reference/image-models.md)、[developers/api/user.md「语音转写」](../developers/api/user.md#语音转写audio-transcriptions) 与 [developers/reference/user-audit-logs.md](../developers/reference/user-audit-logs.md)。
