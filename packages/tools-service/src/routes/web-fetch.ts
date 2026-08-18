/**
 * `POST /v1/tools/web-fetch` — 网页抓取；引擎 / 凭证由调用方在 body 传入。
 **/
import { fetchUrlByProvider, WebFetchProviderError } from '@cloud-api/tool-engines/web-fetch';
import type { WebFetchProvider } from '@cloud-api/core';
import { Hono } from 'hono';
import type { ToolsServiceEnv } from '../app';

type ToolsEnv = ToolsServiceEnv & {
	Variables: Record<string, never>;
};

export const webFetchRoutes = new Hono<ToolsEnv>();

webFetchRoutes.post('/', async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'Invalid JSON body' }, 400);
	}
	const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	const provider = typeof record.provider === 'string' ? record.provider : '';
	const apiKey = typeof record.apiKey === 'string' ? record.apiKey : '';
	const url = typeof record.url === 'string' ? record.url : '';

	if (!provider) {
		return c.json({ error: 'provider is required' }, 400);
	}
	if (!apiKey) {
		return c.json({ error: 'apiKey is required' }, 400);
	}
	if (!url) {
		return c.json({ error: 'url is required' }, 400);
	}

	try {
		const result = await fetchUrlByProvider(provider as WebFetchProvider, {
			apiKey,
			url,
		});
		return c.json({ result });
	} catch (err) {
		if (err instanceof WebFetchProviderError) {
			const status = err.status >= 400 && err.status < 600 ? err.status : 502;
			return c.json({ error: err.message }, status === 400 ? 400 : 502);
		}
		return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
	}
});