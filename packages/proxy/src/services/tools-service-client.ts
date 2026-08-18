/**
 * Tools Service 远程客户端（可选）。
 *
 * 当 Gateway 配置了 `TOOLS_SERVICE_URL` 时，Proxy 将 CPU 密集工具
 * （web-search / web-fetch / web-deep-search / ai-detection）委托给独立
 * Tools Service 执行；未配置则返回 null，路由走内联实现（向后兼容）。
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

/** 从请求上下文读取 Tools Service 配置；无 URL 返回 null（内联模式）。 */
export function resolveToolsServiceConfig(
	c: Pick<Context<GatewayEnv>, 'env'>
): { baseUrl: string; token?: string } | null {
	const baseUrlRaw = c.env?.TOOLS_SERVICE_URL?.trim();
	if (!baseUrlRaw) {
		return null;
	}
	const baseUrl = baseUrlRaw.replace(/\/+$/, '');
	const token = c.env?.TOOLS_SERVICE_TOKEN?.trim() || undefined;
	return { baseUrl, token };
}

type ToolsServiceClient = {
	enabled: true;
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

export function createToolsServiceClient(cfg: { baseUrl: string; token?: string }): ToolsServiceClient {
	return {
		enabled: true,
		baseUrl: cfg.baseUrl,
		webSearch: (provider, params) => remoteWebSearch(cfg, provider, params),
		webFetch: (provider, params) => remoteWebFetch(cfg, provider, params),
		webDeepSearch: (provider, params) => remoteWebDeepSearch(cfg, provider, params),
		aiDetection: (provider, text, entry) => remoteAiDetection(cfg, provider, text, entry),
	};
}

async function postJson(
	cfg: { baseUrl: string; token?: string },
	path: string,
	body: Record<string, unknown>
): Promise<{ status: number; json: unknown }> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (cfg.token) {
		headers['Authorization'] = `Bearer ${cfg.token}`;
	}
	const res = await fetch(`${cfg.baseUrl}${path}`, {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
	});
	const text = await res.text();
	let json: unknown;
	try {
		json = text ? JSON.parse(text) : undefined;
	} catch {
		json = undefined;
	}
	return { status: res.status, json };
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
	cfg: { baseUrl: string; token?: string },
	provider: Parameters<typeof searchWebByProvider>[0],
	params: Parameters<typeof searchWebByProvider>[1]
): Promise<WebSearchResult[]> {
	const r = await postJson(cfg, '/v1/tools/web-search', {
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
	cfg: { baseUrl: string; token?: string },
	provider: Parameters<typeof fetchUrlByProvider>[0],
	params: Parameters<typeof fetchUrlByProvider>[1]
): Promise<WebFetchResult> {
	const r = await postJson(cfg, '/v1/tools/web-fetch', {
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
	cfg: { baseUrl: string; token?: string },
	provider: Parameters<typeof deepSearchByProvider>[0],
	params: Parameters<typeof deepSearchByProvider>[1]
): Promise<WebDeepSearchResult[]> {
	const r = await postJson(cfg, '/v1/tools/web-deep-search', {
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
	cfg: { baseUrl: string; token?: string },
	provider: Parameters<typeof getAiDetectionDriver>[0],
	text: string,
	entry: { secretId: string; secretKey: string; region?: string; bizType?: string }
): Promise<DetectionAggregateResult> {
	const r = await postJson(cfg, '/v1/tools/ai-detection', {
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