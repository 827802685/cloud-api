/**
 * Tools Service 远程客户端（可选，双端点 + 自动切换）。
 *
 * 当 Gateway 配置了 `TOOLS_SERVICE_URL`（主端点，如 Render）时，Proxy 将 CPU 密集工具
 * （web-search / web-fetch / web-deep-search / ai-detection）委托给独立 Tools Service 执行。
 *
 * 自动切换策略（无需手动改域）：
 * - 主端点网络失败、超时、或返回 5xx（冷启动/503/超时）→ 自动回退到 `TOOLS_SERVICE_FALLBACK_URL`（如 CF Worker）。
 * - 主端点连续失败达到阈值后进入冷却期，冷却期内直接走兜底端点（避免 Render 挂掉后每个请求都先等主端点超时）。
 * - 冷却期结束后自动恢复探测主端点；主端点恢复后自动接管主负载。
 * - 4xx 客户端错误不回退（换端点也会同样失败）。
 * - 未配置主 URL 则返回 null，路由走内联实现（向后兼容）。
 */
import type { Context } from 'hono';
import {
	AiDetectionProviderError,
	getAiDetectionDriver,
	detectAiRate,
	type DetectionAggregateResult,
} from '@cloud-api/tool-engines/ai-detection';
import {
	WebDeepSearchProviderError,
	deepSearchByProvider,
	type WebDeepSearchResult,
} from '@cloud-api/tool-engines/web-deep-search';
import {
	WebFetchProviderError,
	fetchUrlByProvider,
	type WebFetchResult,
} from '@cloud-api/tool-engines/web-fetch';
import {
	WebSearchProviderError,
	searchWebByProvider,
	type WebSearchResult,
} from '@cloud-api/tool-engines/web-search';
import type { GatewayEnv } from '@cloud-api/core';

/** 主端点单次请求超时（毫秒）：Render 冷启动/未部署时快速失败并回退，避免挂起拖慢请求。 */
const PRIMARY_REQUEST_TIMEOUT_MS = 10_000;
/** 主端点连续失败达到该次数后进入冷却期。 */
const PRIMARY_FAILURE_THRESHOLD = 3;
/** 主端点冷却期（毫秒）：期间直接走兜底端点，不再等待主端点超时。 */
const PRIMARY_COOLDOWN_MS = 60_000;

/** 单个 Tools Service 端点（baseUrl + 可选内部令牌）。 */
export type ToolsServiceEndpoint = { baseUrl: string; token?: string };

/**
 * Tools Service 自愈配置：兜底端点（CF Worker mcp-key）请求失败时，
 * 触发 GitHub Actions `workflow_dispatch` 重新部署，应对 CPU 超额被停止。
 */
export type ToolsServiceSelfHealConfig = {
	/** GitHub Personal Access Token（需 `actions:write` 权限）。 */
	githubToken: string;
	/** GitHub 仓库 `owner/repo`。 */
	repo: string;
	/** 触发的 workflow 文件名。 */
	workflowFile: string;
	/** 冷却时间（毫秒），避免每次请求都触发。 */
	cooldownMs: number;
};

/**
 * Tools Service 双端点配置：`primary`（Render）优先，`fallback`（CF Worker）兜底。
 */
export type ToolsServiceConfig = {
	primary: ToolsServiceEndpoint;
	fallback?: ToolsServiceEndpoint;
	/** 可选自愈：兜底端点失败时自动触发重新部署。 */
	selfHeal?: ToolsServiceSelfHealConfig;
};

/**
 * 从请求上下文读取 Tools Service 配置；无主 URL 返回 null（内联模式）。
 * 主端点读 `TOOLS_SERVICE_URL` / `TOOLS_SERVICE_TOKEN`，兜底端点读
 * `TOOLS_SERVICE_FALLBACK_URL` / `TOOLS_SERVICE_FALLBACK_TOKEN`。
 * 自愈读 `GH_TOKEN` / `GH_REPO` / `TOOLS_SELF_HEAL_WORKFLOW` / `TOOLS_SELF_HEAL_COOLDOWN_MS`。
 */
export function resolveToolsServiceConfig(
	c: Pick<Context<GatewayEnv>, 'env'>
): ToolsServiceConfig | null {
	const primaryUrlRaw = c.env?.TOOLS_SERVICE_URL?.trim();
	if (!primaryUrlRaw) {
		return null;
	}
	const fallbackUrlRaw = c.env?.TOOLS_SERVICE_FALLBACK_URL?.trim();
	const ghToken = c.env?.GH_TOKEN?.trim();
	const ghRepo = c.env?.GH_REPO?.trim();
	const selfHeal: ToolsServiceSelfHealConfig | undefined =
		ghToken && ghRepo
			? {
					githubToken: ghToken,
					repo: ghRepo,
					workflowFile: c.env?.TOOLS_SELF_HEAL_WORKFLOW?.trim() || 'deploy-tools-service.yml',
					cooldownMs: Number(c.env?.TOOLS_SELF_HEAL_COOLDOWN_MS ?? 300_000) || 300_000,
				}
			: undefined;
	return {
		primary: {
			baseUrl: primaryUrlRaw.replace(/\/+$/, ''),
			token: c.env?.TOOLS_SERVICE_TOKEN?.trim() || undefined,
		},
		fallback: fallbackUrlRaw
			? {
					baseUrl: fallbackUrlRaw.replace(/\/+$/, ''),
					token: c.env?.TOOLS_SERVICE_FALLBACK_TOKEN?.trim() || undefined,
				}
			: undefined,
		selfHeal,
	};
}

// ─── 主端点熔断状态（单实例进程内存，与 provider-circuit-breaker 同模式） ───
let primaryConsecutiveFailures = 0;
let primaryCoolUntil = 0;

/** 测试用：重置主端点熔断状态。 */
export function resetToolsServicePrimaryCircuitForTests(): void {
	primaryConsecutiveFailures = 0;
	primaryCoolUntil = 0;
}

/** 主端点是否处于冷却期（直接走兜底端点）。 */
function isPrimaryCooling(now = Date.now()): boolean {
	return primaryCoolUntil > now;
}

/** 记录主端点失败；达到阈值后进入冷却期。 */
function recordPrimaryFailure(now = Date.now()): void {
	primaryConsecutiveFailures += 1;
	if (primaryConsecutiveFailures >= PRIMARY_FAILURE_THRESHOLD) {
		primaryCoolUntil = now + PRIMARY_COOLDOWN_MS;
		console.warn(
			`[Gateway Tools] primary tools service cooling down for ${PRIMARY_COOLDOWN_MS}ms after ${primaryConsecutiveFailures} consecutive failures`
		);
	}
}

/** 主端点成功：清零连续失败并解除冷却。 */
function recordPrimarySuccess(): void {
	primaryConsecutiveFailures = 0;
	primaryCoolUntil = 0;
}

// ─── 自愈：兜底端点（CF Worker mcp-key）失败时触发 GitHub Actions 重新部署 ───
let lastSelfHealAt = 0;

/** 测试用：重置自愈冷却状态。 */
export function resetToolsServiceSelfHealForTests(): void {
	lastSelfHealAt = 0;
}

/**
 * 触发 GitHub Actions `workflow_dispatch` 重新部署 tools-service。
 * 带冷却去重：冷却期内只触发一次，避免每次请求都触发。
 */
async function triggerSelfHealDispatch(selfHeal: ToolsServiceSelfHealConfig): Promise<void> {
	const now = Date.now();
	if (now - lastSelfHealAt < selfHeal.cooldownMs) {
		return;
	}
	lastSelfHealAt = now;
	console.warn(
		`[Gateway Tools] fallback tools service unreachable, dispatching self-heal redeploy workflow=${selfHeal.workflowFile} repo=${selfHeal.repo}`
	);
	const res = await fetch(
		`https://api.github.com/repos/${selfHeal.repo}/actions/workflows/${selfHeal.workflowFile}/dispatches`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${selfHeal.githubToken}`,
				'X-GitHub-Api-Version': '2022-11-28',
			},
			body: JSON.stringify({ ref: 'main' }),
		}
	);
	if (!res.ok) {
		console.warn(`[Gateway Tools] self-heal dispatch failed status=${res.status}`);
	}
}

type ToolsServiceClient = {
	enabled: true;
	/** 主端点 baseUrl（Render），供日志/审计引用。 */
	baseUrl: string;
	webSearch: typeof searchWebByProvider;
	webFetch: typeof fetchUrlByProvider;
	webDeepSearch: typeof deepSearchByProvider;
	aiDetection: (
		provider: Parameters<typeof getAiDetectionDriver>[0],
		text: string,
		entry: {
			secretId: string;
			secretKey: string;
			region?: string;
			bizType?: string;
		}
	) => Promise<DetectionAggregateResult>;
};

export function createToolsServiceClient(cfg: ToolsServiceConfig): ToolsServiceClient {
	return {
		enabled: true,
		baseUrl: cfg.primary.baseUrl,
		webSearch: (provider, params) => remoteWebSearch(cfg, provider, params),
		webFetch: (provider, params) => remoteWebFetch(cfg, provider, params),
		webDeepSearch: (provider, params) => remoteWebDeepSearch(cfg, provider, params),
		aiDetection: (provider, text, entry) => remoteAiDetection(cfg, provider, text, entry),
	};
}

async function postJson(
	endpoint: ToolsServiceEndpoint,
	path: string,
	body: Record<string, unknown>,
	timeoutMs?: number
): Promise<{ status: number; json: unknown }> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (endpoint.token) {
		headers['Authorization'] = `Bearer ${endpoint.token}`;
	}
	// 超时控制：主端点不可用（DNS 失败会立即抛错，连接挂起则超时中止）时快速失败并回退。
	const controller = new AbortController();
	const timer = timeoutMs
		? setTimeout(() => controller.abort(), timeoutMs)
		: undefined;
	try {
		const res = await fetch(`${endpoint.baseUrl}${path}`, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		const text = await res.text();
		let json: unknown;
		try {
			json = text ? JSON.parse(text) : undefined;
		} catch {
			json = undefined;
		}
		return { status: res.status, json };
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * 带兜底的 POST：先请求主端点（Render），仅当主端点网络失败、超时或返回 5xx
 * （如冷启动/超时/503）时才回退到兜底端点（CF Worker）。
 * 4xx 客户端错误不回退（换端点也会同样失败）。
 *
 * 自动切换增强：主端点连续失败达到阈值后进入冷却期，冷却期内直接走兜底端点，
 * 避免 Render 挂掉后每个请求都先等主端点超时；冷却期结束后自动恢复探测主端点。
 */
async function postJsonWithFallback(
	cfg: ToolsServiceConfig,
	path: string,
	body: Record<string, unknown>
): Promise<{ status: number; json: unknown; usedFallback: boolean }> {
	let lastError: unknown;

	// 主端点冷却期内直接走兜底端点
	if (!isPrimaryCooling()) {
		try {
			const r = await postJson(cfg.primary, path, body, PRIMARY_REQUEST_TIMEOUT_MS);
			if (r.status < 500) {
				recordPrimarySuccess();
				return { ...r, usedFallback: false };
			}
			lastError = new Error(`primary tools service returned ${r.status}`);
			recordPrimaryFailure();
		} catch (err) {
			lastError = err;
			recordPrimaryFailure();
		}
	} else {
		console.warn('[Gateway Tools] primary tools service cooling down, using fallback directly');
	}

	if (cfg.fallback) {
		try {
			const r = await postJson(cfg.fallback, path, body);
			if (r.status < 500) {
				return { ...r, usedFallback: true };
			}
			lastError = new Error(`fallback tools service returned ${r.status}`);
		} catch (err) {
			lastError = err;
		}
		// 兜底端点（CF Worker mcp-key）不可用（网络失败或 5xx，如 CPU 超额被停止）→
		// 触发自愈重新部署（异步，不阻塞请求）
		if (cfg.selfHeal) {
			void triggerSelfHealDispatch(cfg.selfHeal).catch((dispatchErr) => {
				console.warn('[Gateway Tools] self-heal dispatch error', dispatchErr);
			});
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function extractError(json: unknown, fallback: string): string {
	if (json && typeof json === 'object') {
		const err = (json as Record<string, unknown>).error;
		if (typeof err === 'string' && err) {
			return err;
		}
	}
	return fallback;
}

async function remoteWebSearch(
	cfg: ToolsServiceConfig,
	provider: Parameters<typeof searchWebByProvider>[0],
	params: Parameters<typeof searchWebByProvider>[1]
): Promise<WebSearchResult[]> {
	const r = await postJsonWithFallback(cfg, '/v1/tools/web-search', {
		provider,
		apiKey: params.apiKey,
		query: params.query,
		count: params.count,
		allowed_domains: params.allowedDomains,
		blocked_domains: params.blockedDomains,
	});
	if (r.status < 200 || r.status >= 300) {
		throw new WebSearchProviderError(extractError(r.json, 'Web search failed'), r.status, 'remote');
	}
	const results = (r.json as { results?: WebSearchResult[] } | undefined)?.results;
	if (!Array.isArray(results)) {
		throw new WebSearchProviderError('Web search service returned malformed response', 502, 'remote');
	}
	return results;
}

async function remoteWebFetch(
	cfg: ToolsServiceConfig,
	provider: Parameters<typeof fetchUrlByProvider>[0],
	params: Parameters<typeof fetchUrlByProvider>[1]
): Promise<WebFetchResult> {
	const r = await postJsonWithFallback(cfg, '/v1/tools/web-fetch', {
		provider,
		apiKey: params.apiKey,
		url: params.url,
	});
	if (r.status < 200 || r.status >= 300) {
		throw new WebFetchProviderError(extractError(r.json, 'Web fetch failed'), r.status, 'remote');
	}
	const result = (r.json as { result?: WebFetchResult } | undefined)?.result;
	if (!result || typeof result.content !== 'string') {
		throw new WebFetchProviderError('Web fetch service returned malformed response', 502, 'remote');
	}
	return result;
}

async function remoteWebDeepSearch(
	cfg: ToolsServiceConfig,
	provider: Parameters<typeof deepSearchByProvider>[0],
	params: Parameters<typeof deepSearchByProvider>[1]
): Promise<WebDeepSearchResult[]> {
	const r = await postJsonWithFallback(cfg, '/v1/tools/web-deep-search', {
		provider,
		apiKey: params.apiKey,
		query: params.query,
		count: params.count,
	});
	if (r.status < 200 || r.status >= 300) {
		throw new WebDeepSearchProviderError(
			extractError(r.json, 'Web deep search failed'),
			r.status,
			'remote'
		);
	}
	const results = (r.json as { results?: WebDeepSearchResult[] } | undefined)?.results;
	if (!Array.isArray(results)) {
		throw new WebDeepSearchProviderError(
			'Web deep search service returned malformed response',
			502,
			'remote'
		);
	}
	return results;
}

async function remoteAiDetection(
	cfg: ToolsServiceConfig,
	provider: Parameters<typeof getAiDetectionDriver>[0],
	text: string,
	entry: { secretId: string; secretKey: string; region?: string; bizType?: string }
): Promise<DetectionAggregateResult> {
	const r = await postJsonWithFallback(cfg, '/v1/tools/ai-detection', {
		provider,
		text,
		secretId: entry.secretId,
		secretKey: entry.secretKey,
		region: entry.region,
		bizType: entry.bizType,
	});
	if (r.status < 200 || r.status >= 300) {
		throw new AiDetectionProviderError(
			extractError(r.json, 'AI detection failed'),
			r.status,
			'remote'
		);
	}
	const result = (r.json as { result?: DetectionAggregateResult } | undefined)?.result;
	if (!result || !Array.isArray(result.segments)) {
		throw new AiDetectionProviderError('AI detection service returned malformed response', 502, 'remote');
	}
	return result;
}

/** 批量取得 4 个工具类型，供路由内联/远程切换复用。 */
export type { WebSearchResult, WebFetchResult, WebDeepSearchResult, DetectionAggregateResult };
export {
	getAiDetectionDriver,
	detectAiRate,
	WebSearchProviderError,
	WebFetchProviderError,
	WebDeepSearchProviderError,
	AiDetectionProviderError,
	searchWebByProvider,
	fetchUrlByProvider,
	deepSearchByProvider,
};
