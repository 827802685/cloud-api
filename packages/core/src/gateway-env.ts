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
	 * Tools Service 主端点基址（例如 Render 的 `https://cloud-api-tools.onrender.com`）。
	 * 配置后，Proxy 将 web-search / web-fetch / web-deep-search / ai-detection 委托给该服务执行，
	 * 从而把 CPU 密集工具负载移出 Gateway Worker；未配置则走内联实现（向后兼容）。
	 */
	TOOLS_SERVICE_URL?: string;
	/** 主端点内部令牌；配置则 Proxy 调用时携带 `Authorization: Bearer <token>`。 */
	TOOLS_SERVICE_TOKEN?: string;
	/**
	 * Tools Service 兜底端点基址（例如 CF Worker `https://mcp.zjkl.dpdns.org`）。
	 * 主端点网络失败或返回 5xx（如 Render 冷启动/超时）时自动回退；未配置则无兜底。
	 */
	TOOLS_SERVICE_FALLBACK_URL?: string;
	/** 兜底端点内部令牌；配置则回退调用时携带 `Authorization: Bearer <token>`。 */
	TOOLS_SERVICE_FALLBACK_TOKEN?: string;
	/**
	 * Tools Service 自愈：GitHub Personal Access Token（需 `actions:write` 权限）。
	 * 配置后，当兜底端点（CF Worker mcp-key）请求失败时，主 worker 自动触发
	 * GitHub Actions `workflow_dispatch` 重新部署 mcp-key（应对 CPU 超额被停止）。
	 * 未配置则禁用自愈。
	 */
	GH_TOKEN?: string;
	/** GitHub 仓库 `owner/repo`（如 `827802685/cloud-api`）；与 GH_TOKEN 配合启用自愈。 */
	GH_REPO?: string;
	/** 自愈触发的 workflow 文件名（默认 `deploy-tools-service.yml`）。 */
	TOOLS_SELF_HEAL_WORKFLOW?: string;
	/** 自愈冷却时间（毫秒），避免每次请求都触发；默认 5 分钟。 */
	TOOLS_SELF_HEAL_COOLDOWN_MS?: string;
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
