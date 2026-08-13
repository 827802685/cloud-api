/**
 * 共享 Gateway 环境类型：Proxy 和 Admin 统一使用。
 * 确保两个 Hono 应用可以互相挂载路由而不出现类型不兼容。
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { GatewayRepositories } from './storage/repositories-types';
import type { StorageContext } from './storage/context';

/** API Key 鉴权上下文，由 proxy `requireApiKey` 中间件注入。 */
export type ApiKeyContext = {
	/** `api_keys.id` */
	keyId: string;
	userId: string;
	userEmail: string | null;
	budgetMax: number | null;
	budgetSpent: number;
	budgetPeriod: string;
	budgetResetAt: string | null;
	metadata: Record<string, unknown> | null;
};

/** Cloudflare Workers 绑定：D1 数据库 + 可选静态资源。 */
export type GatewayBindings = {
	DB?: D1Database;
	ASSETS?: unknown;
	DATABASE_URL?: string;
	DATABASE_DRIVER?: string;
	STORAGE_CONTEXT?: StorageContext;
	/** 免费模型 RSS 同步源地址（可配置，便于后续改域名）。 */
	RSS_SYNC_URL?: string;
};

/**
 * 统一 Gateway 环境类型。
 * Proxy 和 Admin 共用此类型，确保 Hono 路由可以跨应用挂载。
 */
export type GatewayEnv = {
	Bindings: GatewayBindings;
	Variables: {
		repositories: GatewayRepositories;
		apiKey?: ApiKeyContext;
	};
};
