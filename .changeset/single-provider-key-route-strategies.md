---
"@octafuse/core": major
"@octafuse/proxy": major
"@octafuse/admin": major
---

单键化 Provider（一个 provider 一把 api_key）并引入可切换路由策略。

**破坏性变更**
- 删除 `provider_api_keys` 表与 Admin `/providers/:id/keys*` API；密钥写入 `providers.api_key`，启用状态为 `providers.status`
- 删除网关侧 per-key RPM/TPM/并发软限流与粘性 key 绑定（`models.sticky_config`）
- `models.sticky_config` 替换为 `models.route_policy`；`model_routes` 新增 `weight`
- 新增全局 `system_config.ROUTE_STRATEGY`（默认 `affinity`）与四策略：`affinity` / `weighted_random` / `strict` / `round_robin`
- Proxy 调度改为 priority 分层 + 策略排序 + provider 维度熔断；请求日志 `provider_key_*` 列语义改为 provider id/name/fingerprint

上线前请用 `scripts/db/export-provider-api-keys.mjs` 导出密钥，再应用迁移 `0015_single_provider_key.sql`。详见 `docs/operators/migrations/single-provider-key-cutover.md`。
