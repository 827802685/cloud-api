# 接入 Trae / Codex / CC Switch / CodeBuddy / WorkBuddy / AstrBot

本页面向想把 Octafuse Gateway 作为统一模型网关，接入各种 AI 编程工具与机器人框架的使用者。

核心思路：**Gateway 同时暴露 OpenAI、Anthropic、Gemini 三种协议**，因此几乎所有工具都能通过「自定义 Base URL + 用户 API Key」接入，无需改工具源码。你只需要：

1. 在 Admin 中配置好模型与路由（见 [configuration.md](./configuration.md)）。
2. 在 Admin → 用户中创建用户 API Key（`sk-...`）。
3. 按下表把工具指向 Gateway 的 `GATEWAY_URL`。

> 下文所有 `GATEWAY_URL` 均指 Proxy Worker 根地址（如 `https://gateway.example.com`），`USER_API_KEY` 指你在 Admin 创建的用户 Key。模型名用 `baseId` 或 `baseId:route_group`（如 `glm-4.7-flash:free`）。

## 概览

| 工具 | 协议 | 配置位置 | 关键字段 |
|------|------|----------|----------|
| TraeCode CLI | OpenAI / Anthropic | `trae_cli.yaml` | `open_ai.base_url` / `claude.base_url` |
| TraeCode IDE / TraeWork | OpenAI / Anthropic | 设置 → 模型 → 自定义配置 | API 格式 + 请求地址 |
| Codex CLI | OpenAI（Chat） | `~/.codex/config.toml` | `openai_base_url` / `[model_providers.*]` + `wire_api="chat"` |
| Codex++（CodexPlusPlus） | OpenAI（Chat） | GUI 中转注入 → `~/.codex/config.toml` | `wire_api="chat"` |
| CC Switch | Anthropic / OpenAI / Gemini | GUI 添加 Provider | Base URL + API Key |
| CodeBuddy | OpenAI | `~/.codebuddy/models.json` | `url`（以 `/chat/completions` 结尾） |
| WorkBuddy | OpenAI | 设置 → 模型 → 自定义 | `url` / `apiKey` |
| AstrBot | OpenAI | `data/cmd_config.json` | `api_base` / `key` |

---

## 1. TraeCode CLI

TraeCode CLI 通过全局配置文件 `trae_cli.yaml` 添加自定义模型。用 `traecli config edit` 打开（或手动创建），文件路径：

- macOS：`~/Library/Application Support/trae_cli/trae_cli.yaml`
- Linux：`$XDG_CONFIG_HOME/trae_cli/trae_cli.yaml`（未设置则为 `~/.config/trae_cli/trae_cli.yaml`）
- Windows：`%USERPROFILE%\AppData\Roaming\trae_cli\trae_cli.yaml`

**OpenAI 兼容（推荐，走 Gateway 的 `/v1/chat/completions`）：**

```yaml
models:
  - name: "Gateway GLM"
    open_ai:
      base_url: https://GATEWAY_URL/v1
      api_key: "USER_API_KEY"
      model: "glm-4.7-flash:free"
```

**Anthropic 兼容（走 Gateway 的 `/v1/messages`）：**

```yaml
models:
  - name: "Gateway Claude"
    claude:
      base_url: https://GATEWAY_URL
      model: "claude-3-7-sonnet"
      api_key: "USER_API_KEY"
```

可在一个 `models` 列表下添加多个模型，运行时用 `traecli -c model.name=xxx` 切换。

---

## 2. TraeCode IDE / TraeWork

1. 打开 **设置 → 模型 → 添加模型 → 自定义配置**。
2. 选择 **API 格式**：
   - **OpenAI Chat Completions 格式**：请求地址填 `https://GATEWAY_URL/v1`（或打开「完整 URL」填 `https://GATEWAY_URL/v1/chat/completions`）。
   - **Anthropic Messages 格式**：请求地址填 `https://GATEWAY_URL`（或完整 URL 填 `https://GATEWAY_URL/v1/messages`）。
3. 输入模型 ID（如 `glm-4.7-flash:free`）、打开多模态开关（按需）、填 API 密钥 `USER_API_KEY`。
4. 点击添加，TraeCode 会调用接口校验密钥。

---

## 3. Codex CLI

Codex CLI 默认使用 OpenAI **Responses API**（`wire_api="responses"`），而 Gateway 暴露的是 **Chat Completions**（`/v1/chat/completions`）。因此接入时**必须**把 `wire_api` 设为 `"chat"`。

**方式一：环境变量（最简单）**

```bash
export OPENAI_BASE_URL="https://GATEWAY_URL/v1"
export OPENAI_API_KEY="USER_API_KEY"
codex
```

**方式二：`openai_base_url` 配置项（`~/.codex/config.toml`）**

```toml
# ~/.codex/config.toml
openai_base_url = "https://GATEWAY_URL/v1"
model = "glm-4.7-flash:free"
```

**方式三：自定义 model provider（推荐，可指定 `wire_api="chat"`）**

```toml
# ~/.codex/config.toml
model = "glm-4.7-flash:free"
model_provider = "gateway"

[model_providers.gateway]
name = "Octafuse Gateway"
base_url = "https://GATEWAY_URL/v1"
env_key = "OPENAI_API_KEY"
wire_api = "chat"
```

> 关键：`wire_api` 必须为 `"chat"`（Chat Completions）。若省略，Codex 默认用 `"responses"`，Gateway 当前不提供该端点。

---

## 4. Codex++（CodexPlusPlus）

Codex++ 通过「中转注入」把 Codex 桌面 App 的模型请求指向自定义 OpenAI 兼容接口：

1. 打开 Codex++ 管理工具 → **中转注入** 页面。
2. 添加 Base URL `https://GATEWAY_URL/v1` 和 API Key `USER_API_KEY`。
3. 应用中转注入。它会向 `~/.codex/config.toml` 写入类似配置：

```toml
model_provider = "CodexPlusPlus"

[model_providers.CodexPlusPlus]
name = "CodexPlusPlus"
wire_api = "chat"          # 必须为 chat（Gateway 提供 Chat Completions）
base_url = "https://GATEWAY_URL/v1"
experimental_bearer_token = "USER_API_KEY"
```

> 若 Codex++ 默认写入 `wire_api = "responses"`，请手动改为 `"chat"`，否则请求会打到不存在的 `/v1/responses`。

---

## 5. CC Switch

CC Switch（farion1231/cc-switch）是一个统一管理 Claude Code / Codex / Gemini 等多个工具的桌面应用，通过 GUI 添加 Provider 即可。

1. 打开 CC Switch → **Add Provider**。
2. 选择「自定义 / Custom」，填写 Base URL 与 API Key。
3. 按目标工具选择协议入口：

| 目标工具 | 协议 | Base URL |
|----------|------|----------|
| CC Switch → Claude Code | Anthropic | `https://GATEWAY_URL`（`/v1/messages`） |
| CC Switch → Codex | OpenAI（Chat） | `https://GATEWAY_URL/v1`（需 `wire_api="chat"`） |
| CC Switch → Gemini | Gemini | `https://GATEWAY_URL/v1beta/models` |

4. 保存并切换。多数工具切换后需重启终端/CLI 生效。

> 若你的 CC Switch 版本默认把 Codex 配成 Responses API，参照上文 Codex 一节改为 Chat Completions。

---

## 6. CodeBuddy

CodeBuddy 通过 `models.json` 定义自定义模型，**仅支持 OpenAI 接口格式**，且 `url` 必须是完整路径（以 `/chat/completions` 结尾）。

配置文件路径：用户级 `~/.codebuddy/models.json`，项目级 `<项目>/.codebuddy/models.json`（项目级优先）。

```json
{
  "models": [
    {
      "id": "gateway-glm",
      "name": "Gateway GLM",
      "vendor": "Custom",
      "apiKey": "USER_API_KEY",
      "url": "https://GATEWAY_URL/v1/chat/completions",
      "maxInputTokens": 128000,
      "maxOutputTokens": 4096,
      "supportsToolCall": true
    }
  ],
  "availableModels": ["gateway-glm"]
}
```

支持热重载，保存后即可在 CodeBuddy 中选用。

---

## 7. WorkBuddy

WorkBuddy 与 CodeBuddy 同属腾讯云代码助手生态，共用 `models.json`，也支持可视化界面配置（设置 → 模型 → 添加自定义模型）。

**可视化方式：** 选择「自定义 / Custom」，填写 URL、API Key、模型名。若网关 URL 路径非标准，可在高级配置中开启「自定义协议」以跳过路径校验。

**配置文件方式（`~/.codebuddy/models.json`）：**

```json
{
  "models": [
    {
      "id": "gateway-model",
      "name": "Gateway Model",
      "vendor": "Custom",
      "url": "https://GATEWAY_URL/v1/chat/completions",
      "apiKey": "USER_API_KEY",
      "maxInputTokens": 128000,
      "maxOutputTokens": 4096
    }
  ]
}
```

> OpenAI 兼容 base URL 需带 `/v1`（如 `https://GATEWAY_URL/v1/chat/completions`），这是常见配置失败原因。

---

## 8. AstrBot

AstrBot 适配 OpenAI / Google GenAI / Anthropic 三种原生 API 格式，可接入任意 OpenAI 兼容网关。

**可视化方式（推荐）：** AstrBot 控制台 → 服务提供商 → 新增提供商 → 选择 `OpenAI` → 填 API Key 与 API Base URL → 获取模型列表 → 添加模型 → 在配置文件页设置对话模型。

**配置文件方式（`data/cmd_config.json`）：**

```json
{
  "provider": [
    {
      "id": "gateway",
      "type": "openai_chat_completion",
      "model": "glm-4.7-flash:free",
      "key": ["USER_API_KEY"],
      "api_base": "https://GATEWAY_URL/v1",
      "enable": true
    }
  ]
}
```

> v4.13.0 起支持用环境变量加载 Key（`key` 填 `$环境变量名`）。

---

## 常见问题

**Codex / Codex++ 请求失败？**
Gateway 当前提供的是 OpenAI **Chat Completions**（`/v1/chat/completions`），不是 Responses API（`/v1/responses`）。请确保 Codex 的 `wire_api` 为 `"chat"`。

**Trae 校验密钥失败？**
确认 Base URL 正确（OpenAI 用 `GATEWAY_URL/v1`，Anthropic 用 `GATEWAY_URL`），且模型 ID 在 Gateway 中有活跃路由。可用 `curl -sS $GATEWAY_URL/v1/models -H "Authorization: Bearer $USER_API_KEY"` 先验证。

**模型名怎么写？**
用 `baseId` 或 `baseId:route_group`（如 `glm-4.7-flash:free`）。免费模型通常配 `free` 路由组。完整规则见 [developers/api/user.md](../developers/api/user.md)。
