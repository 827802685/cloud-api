---
"octafuse": minor
"@octafuse/core": minor
"@octafuse/proxy": minor
"@octafuse/admin": minor
---

### Proxy / Core

- **Audio Transcriptions**：新增 OpenAI 兼容 `POST /v1/audio/transcriptions`（multipart；预算预检、OpenAI 路由故障转移；请求日志不落音频二进制）。
- **Audio 计费双模式**：`pricing_profile.audio_billing_mode` 支持 **`per_second`（按时长）** 与 **`token`（按上游 usage）**；日志 `billing_kind` 为 `audio_per_second` / `audio_tokens`；迁移 **`0014_request_log_audio_billing`**（`audio_duration_seconds`）。
- **`GET /v1/models`**：`kind` 支持 `audio`（默认仍仅 LLM；`kind=all` 不过滤）。
- **Provider endpoints**：OpenAI 能力含 `audio.transcriptions`（可由 `base` 派生或显式完整 URL）。

### Admin UI

- **Models / Routes**：Kind 支持 **Audio**；模型表单与路由计费面板支持 Audio 双模式目录价。
- **Playground / Simulator**：支持语音转写联调（上传音频 → `/v1/audio/transcriptions`）。
- **Request Logs**：展示 Audio 计费种类与时长 / token 审计信息。
- **Providers**：端点能力识别含 audio；完善 Provider 身份与导入体验。

### 模型 / Provider 预设

- **Audio**：`openai-audio.json`（`whisper-1` 按秒；`gpt-4o-mini-transcribe` / `gpt-4o-transcribe` / `gpt-4o-transcribe-diarize` 按 token）。
- **新增**：Claude Opus 5；七牛 / OpenCode / ZenMux 等 Vendor 预设与图标；Catalog 本地化描述与链接；图像模型目录价与文案校正。

### 文档

- 更新 README（多语言）与用户 / 开发者 / 运维文档，覆盖 Audio 双模式计费、Admin 验收与 Cloudflare 部署说明。
