# @octafuse/tool-engines

## 2.1.0

### Minor Changes

- [`3a53d2f`](https://github.com/OctaFuse/octafuse-gateway/commit/3a53d2f1b3e11308e7d5497b895978d55c37f152) Thanks [@dyc87112](https://github.com/dyc87112)! - ### Proxy / Core

  - **Tools / AI Detection**：新增 `POST /v1/tools/ai-detection`（腾讯 TMS 引擎；按字符计费单元扣预算）。
  - **Tools / Pricing**：新增只读 `GET /v1/tools/pricing`（返回工具单价；不含引擎密钥）。
  - **工具三账本定价**：web-search / web-fetch / web-deep-search / ai-detection 统一 **metered / standard / charged**；`cost` 为 charged 兼容别名。
  - **`@octafuse/tool-engines`**：抽出共享引擎客户端包（web-search / web-fetch / web-deep-search / ai-detection）；Proxy 与 Admin Playground 共用，避免 Admin 直接依赖 Proxy 源码。

  ### Admin UI

  - **Tools**：配置页全局 secrets 显隐；调用记录展示 std / charged / metered / profit 与 engine provider。
  - **Request Logs**：区分 agent tools 与上游模型，展示引擎 provider。
  - **Playground / Simulator**：支持 AI Detection 联调。
  - **Providers**：删除时若仍被 `model_routes` 引用则拒绝，避免断路由。

  ### 文档 / 工程

  - 更新用户 / 开发者 / 运维文档与 API 说明（工具定价、AI Detection、route topology）。
  - Docker 构建纳入 `packages/tool-engines`；新增 docker-compose smoke workflow。

### Patch Changes

- Updated dependencies [[`3a53d2f`](https://github.com/OctaFuse/octafuse-gateway/commit/3a53d2f1b3e11308e7d5497b895978d55c37f152)]:
  - @octafuse/core@2.1.0
