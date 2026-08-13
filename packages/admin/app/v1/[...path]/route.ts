/**
 * Gateway API 代理（裸路径）：`/v1/*` → 直接交给 Proxy Hono 应用。
 *
 * 这是对外暴露的标准 API 入口（例如 `https://api.zjkl.dpdns.org/v1/chat/completions`）。
 * 与 `/api/v1/*` 共享同一份处理逻辑（见 `lib/gateway-v1-handler.ts`），
 * 保证域名无论指向哪个 Worker，`/v1` 都能作为 API 正常使用。
 */
export { GET, POST, PUT, PATCH, DELETE, OPTIONS } from '@/lib/gateway-v1-handler';

export const dynamic = 'force-dynamic';
