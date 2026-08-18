/**
 * `POST /v1/tools/ai-detection` — AI 率检测；核心凭证由调用方在 body 传入。
 * 服务端切段并发检测，计费由调用方（Gateway Proxy）负责。
 **/
import { detectAiRate, getAiDetectionDriver } from '@cloud-api/tool-engines/ai-detection';
import type { AiDetectionProvider, ResolvedAiDetectionConfig } from '@cloud-api/core';
import { Hono } from 'hono';
import type { ToolsServiceEnv } from '../app';

type ToolsEnv = ToolsServiceEnv & {
	Variables: Record<string, never>;
};

export const aiDetectionRoutes = new Hono<ToolsEnv>();

aiDetectionRoutes.post('/', async (c) => {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'Invalid JSON body' }, 400);
	}
	const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	const provider = typeof record.provider === 'string' ? record.provider : '';
	const text = typeof record.text === 'string' ? record.text.trim() : '';

	if (!provider) {
		return c.json({ error: 'provider is required' }, 400);
	}
	if (!text) {
		return c.json({ error: 'text is required' }, 400);
	}

	const driver = getAiDetectionDriver(provider as AiDetectionProvider);
	if (!driver) {
		return c.json({ error: `AI detection provider is not implemented: ${provider}` }, 503);
	}

	// 仅凭证字段固定传入；计费字段不参与检测逻辑，置 0（调用方 Proxy 计费）。
	const cfg = buildDetectionConfig(provider as AiDetectionProvider, record);
	if (!cfg) {
		return c.json({ error: 'AI detection provider credentials missing' }, 400);
	}

	try {
		const result = await detectAiRate(text, driver, cfg);
		return c.json({ result });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message === 'EMPTY_CONTENT') {
			return c.json({ error: 'text is required' }, 400);
		}
		return c.json({ error: message }, 502);
	}
});

function buildDetectionConfig(
	provider: AiDetectionProvider,
	record: Record<string, unknown>
): ResolvedAiDetectionConfig | null {
	const secretId = typeof record.secretId === 'string' ? record.secretId.trim() : '';
	const secretKey = typeof record.secretKey === 'string' ? record.secretKey.trim() : '';
	if (!secretId || !secretKey) {
		return null;
	}
	const region = typeof record.region === 'string' && record.region.trim() ? record.region.trim() : undefined;
	const bizType = typeof record.bizType === 'string' && record.bizType.trim() ? record.bizType.trim() : undefined;

	return {
		provider,
		entry: {
			secretId,
			secretKey,
			...(region ? { region } : {}),
			...(bizType ? { bizType } : {}),
			cost: 0,
			metered: 0,
			standard: 0,
			charged: 0,
		},
		cost: 0,
		metered: 0,
		standard: 0,
		charged: 0,
		billingUnitChars: 2000,
		sources: {
			provider: 'default',
			cost: 'default',
			billingUnitChars: 'default',
			mode: 'catalog',
		},
	};
}