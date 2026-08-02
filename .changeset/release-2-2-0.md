---
"octafuse": minor
"@octafuse/core": minor
"@octafuse/tool-engines": minor
"@octafuse/proxy": minor
"@octafuse/admin": minor
---

### Proxy

- **User+model 熔断**：敏感内容与普通上游 400 共用 `20s → 1m → 3m → 5m → 10m` 退避（不区分请求体）；短路用 code 区分类别（`circuit.sensitive_content` / `circuit.client_error`）。替换原独立 sensitive-content 熔断实现。
- **Images / Audio**：退出普通 400（`client_error`）熔断，仅保留 sensitive_content 触发。
- **Failover**：循环内复查已熔断 provider；401/403 provider 冷却由 10min 调整为 5min。
- **错误码契约**：网关自造 / 熔断 / 上游分类错误增加固定 `code`（`gateway.*` / `circuit.*` / `upstream.*`）与响应头 `X-OctaFuse-Error-Code`；body 既有 `error` 形状纯增量。
- **诊断**：`gateway.upstream_request_failed` 的 message 附带原始 fetch 错误摘要（与 `route_resolution_failed` 一致），便于客户端与 Langfuse 排查。

### 文档

- 更新 API 与 `proxy-request-lifecycle` / `runtime-data` 说明，覆盖错误码头与 user+model 熔断行为。
