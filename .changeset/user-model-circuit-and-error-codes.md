---
"octafuse": minor
"@octafuse/proxy": minor
"@octafuse/core": minor
"@octafuse/admin": minor
---

Proxy：补齐 user+model 熔断（敏感内容与普通上游 400 共用 20s→1m→3m→5m→10m 退避，不区分请求体；短路 code 区分类别）；images / audio 退出普通 400（`client_error`）熔断，仅保留 sensitive_content；failover 循环内复查已熔断 provider；401/403 provider 冷却 10min→5min；错误响应增加固定 code（`gateway.*` / `circuit.*` / `upstream.*`）与 `X-OctaFuse-Error-Code` 响应头（body 形状纯增量）。
