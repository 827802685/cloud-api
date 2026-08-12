/**
 * Proxy Hono 应用工厂：供 Admin Worker 挂载 Proxy 路由。
 * 直接复用 `@cloud-api/proxy` 导出的 `workerApp`，它已包含完整的路由和中间件链。
 *
 * 当挂载在 Admin 应用上时：
 * - Admin 外层的存储解析中间件先设置 `repositories`
 * - Proxy 的存储解析中间件检测到 `repositories` 已存在，自动跳过
 * - Proxy 的 API Key 鉴权中间件正常工作
 */
import type { GatewayEnv } from '@cloud-api/core';
import type { Hono } from 'hono';
import workerApp from '@cloud-api/proxy';

let cached: Hono<GatewayEnv> | undefined;

export function getProxyApp(): Hono<GatewayEnv> {
	if (!cached) {
		cached = workerApp as unknown as Hono<GatewayEnv>;
	}
	return cached;
}
