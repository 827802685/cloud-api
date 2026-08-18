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
	/** Cloudflare Workers AI binding（`env.AI`），用于 RSS 同步时的智能归类；未配置则跳过。 */
	AI?: unknown;
	/** Cloudflare API Token（Workers AI REST 通道，需与 CF_ACCOUNT_ID 配合）。 */
	CF_API_TOKEN?: string;
	/** Cloudflare Account ID（Workers AI REST 通道）。 */
	CF_ACCOUNT_ID?: string;
	/**
	 * Tools Service 基址（例如 `https://tools.example.com` 或 Node 容器 `http://127.0.0.1:8899`）。
	 * 配置后，Proxy 将 web-search / web-fetch / web-deep-search / ai-detection 委托给该服务执行，
	 * 从而把 CPU 密集工具负载移出 Gateway Worker；未配置则走内联实现（向后兼容）。
	 */
	TOOLS_SERVICE_URL?: string;
	/** 可选的 Tools Service 内部令牌；配置则 Proxy 调用时携带 `Authorization: Bearer <token>`。 */
	TOOLS_SERVICE_TOKEN?: string;
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
