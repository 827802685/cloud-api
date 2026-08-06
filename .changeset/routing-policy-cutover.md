---
"octafuse": minor
---

OctaFuse Gateway v2.2.0 统一 Gemini Generate Content 路由语义，并将路由策略配置升级为可按 priority 层覆盖的 canonical 策略体系。

### Proxy

- **Gemini operation 收敛**：公开 Surface 与上游 Target 统一使用 `models.generate`，流式与非流式请求共享同一 Route Pool；真实 wire action 继续使用 `generateContent` / `streamGenerateContent` 并写入 `route_trace.gemini.action`。
- **Canonical 路由策略**：仅接受 `cache_affinity`、`weighted_random`、`fixed_order`、`weighted_round_robin`；不再接受 `affinity`、`strict`、`round_robin`。
- **按层策略**：Route Pool 可通过 `tier_strategies` 为不同 priority 层设置独立排序策略，未覆盖的层继续使用 Pool / 模型 / 全局策略。

### Admin

- **Routes 策略编辑**：全局、Pool 与 priority 层统一使用可视化策略选择器；每层可查看实际策略来源与 Failover 规则。
- **Provider Gemini 配置**：新配置优先写入单一 `models.generate` URL 模板（`{model}:{action}`），无法安全合并的历史双模板会保留并提示复核。
- **Agent Tools Provider 卡片**：通过卡片与右侧抽屉维护凭证及 Standard / Charged / Metered 三账本单价，支持“仅保存配置”与“保存并启用”，并提示未保存、缺凭证、不可用和亏损定价状态。

### Core

- **迁移 0017**：合并 Gemini `generateContent` / `streamGenerateContent` Surface，规范化 Target operation，并标记需要人工复核的冲突 Pool。
- **迁移 0018**：为 `route_pools` 新增可空的 `tier_strategies` JSON 列。
- **迁移 0019**：改写全局、模型、Pool 与按层配置中的旧路由策略 ID。

### 文档

- **Docker 升级**：补充预构建镜像与本地构建场景的版本更新、迁移、重建和冒烟步骤。
- **迁移 Runbook**：新增 0017–0019 的发布顺序、校验、冲突处理和回滚说明。

### 升级说明

- **数据库迁移**：必须应用 0017、0018、0019；三种数据库的迁移语义一致。
- **发布顺序**：备份数据库并暂停 Proxy 流量与 Admin 配置写入，先执行全部迁移，再检查 `[v220-conflict]` Gemini Pool，随后立即部署同一版本的 Proxy 与 Admin；禁止新旧版本混跑。
- **配置变更**：所有持久化路由策略 ID 会迁移为 canonical 名称；外部自动化写入也必须同步使用新 ID。
- **兼容性影响**：客户端 Gemini URL 不变；Admin / API 的 Gemini operation 配置改为 `models.generate`。历史 Provider per-action endpoint 模板仍兼容读取，历史路由策略 ID 不再接受。
- **建议操作**：部署后分别验证 Gemini 流式/非流式请求、全局/Pool/priority 层策略、Tools Active Provider 与三账本日志。
