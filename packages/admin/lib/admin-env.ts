import type { GatewayEnv, GatewayBindings } from '@cloud-api/core';

/** Admin 绑定类型：与 GatewayBindings 对齐，保留 STORAGE_CONTEXT 扩展。 */
export type AdminBindings = GatewayBindings;

/**
 * Admin Hono 应用环境类型。
 * 与 Proxy 共用 GatewayEnv，确保路由可以跨应用挂载。
 */
export type AdminEnv = GatewayEnv;
