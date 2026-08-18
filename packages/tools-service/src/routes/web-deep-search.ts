/**
 * `POST /v1/tools/web-deep-search` — 搜 + 读一体；引擎 / 凭证由调用方在 body 传入。
 **/
import {
	clampDeepSearchCount,
	deepSearchByProvider,
	WebDeepSearchProviderError,
} from '@cloud-api/tool-engines/web-deep-search';
import type { WebDeepSearchProvider } from '@cloud-api/core';
import { Hono } from 'hono';
import type { ToolsServiceEnv } from '../app';

type ToolsEnv = ToolsServiceEnv & {
	Variables: Record<string, never>;
};

export const webDeepSearchRoutes = new Hono<ToolsEnv>();

webDeepSearchRoutes.post('/', async (c) => {
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

	const count = typeof record.count === 'number' ? clampDeepSearchCount(record.count) : undefined;

	try {
		const results = await deepSearchByProvider(provider as WebDeepSearchProvider, {
			apiKey,
			query,
			count,
		});
		return c.json({ results });
	} catch (err) {
		if (err instanceof WebDeepSearchProviderError) {
			const status = err.status >= 400 && err.status < 600 ? err.status : 502;
			return c.json({ error: err.message }, status === 400 ? 400 : 502);
		}
		return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
	}
});