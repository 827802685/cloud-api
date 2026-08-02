---
"@octafuse/proxy": patch
"octafuse": patch
---

Proxy：`gateway.upstream_request_failed` 响应 message 附带原始 fetch 错误摘要（与 `route_resolution_failed` 一致），便于客户端与 Langfuse 诊断。
