/**
 * Gateway API 代理：`/api/v1/*` → 内部重写为 `/v1/*` 后交给 Proxy Hono 应用。
 * 与 `/api/admin/*` 类似，但走 Proxy 路由（含 API Key 鉴权、模型路由、failover 等）。
 *
 * 前端调用方式：
 * - 浏览器：`fetch('/api/v1/chat/completions', { ... })`
 * - 外部客户端：`fetch('https://<worker>/api/v1/chat/completions', { headers: { 'Authorization': 'Bearer sk-...' } })`
 *
 * 共享逻辑见 `lib/gateway-v1-handler.ts`（同时服务 `/api/v1/*` 与裸 `/v1/*`）。
 */
export { GET, POST, PUT, PATCH, DELETE, OPTIONS } from '@/lib/gateway-v1-handler';

export const dynamic = 'force-dynamic';
