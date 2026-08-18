/**
 * `POST /v1/tools/web-search` — 联网搜索；引擎 / 凭证由调用方在 body 传入。
 **/
import { searchWebByProvider, WebSearchProviderError } from '@cloud-api/tool-engines/web-search';
import type { WebSearchProvider } from '@cloud-api/core';
import { Hono } from 'hono';
import type { ToolsServiceEnv } from '../app';

type ToolsEnv = ToolsServiceEnv & {
	Variables: Record<string, never>;
};

export const webSearchRoutes = new Hono<ToolsEnv>();

webSearchRoutes.post('/', async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'Invalid JSON body' }, 400);
	}
	const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	const provider = typeof record.provider === 'string' ? record.provider : '';
	const apiKey = typeof record.apiKey === 'string' ? record.apiKey : '';
	const query = typeof record.query === 'string' ? record.query.trim() : '';

	if (!provider) {
		return c.json({ error: 'provider is required' }, 400);
	}
	if (!apiKey) {
		return c.json({ error: 'apiKey is required' }, 400);
	}
	if (query.length < 2) {
		return c.json({ error: 'query must be at least 2 characters' }, 400);
	}

	const allowedDomains = toStringArray(record.allowed_domains);
	const blockedDomains = toStringArray(record.blocked_domains);
	if (allowedDomains?.length && blockedDomains?.length) {
		return c.json({ error: 'Cannot specify both allowed_domains and blocked_domains' }, 400);
	}
	const count = typeof record.count === 'number' ? record.count : undefined;

	try {
		const results = await searchWebByProvider(provider as WebSearchProvider, {
			apiKey,
			query,
			count,
			allowedDomains,
			blockedDomains,
		});
		return c.json({ results });
	} catch (err) {
		if (err instanceof WebSearchProviderError) {
			const status = err.status >= 400 && err.status < 600 ? err.status : 502;
			return c.json({ error: err.message }, status === 400 ? 400 : 502);
		}
		return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
	}
});

function toStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const out = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
	return out.length > 0 ? out : undefined;
}