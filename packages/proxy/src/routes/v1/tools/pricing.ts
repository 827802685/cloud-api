/**
 * 用户路由：`GET /v1/tools/pricing` — 只读工具定价（不含 provider 密钥与 Active 引擎名）。
 */
import {
	BILLING_CURRENCY_KEY,
	DEFAULT_AI_DETECTION_BILLING_UNIT_CHARS,
	DEFAULT_AI_DETECTION_COST,
	DEFAULT_WEB_DEEP_SEARCH_COST,
	DEFAULT_WEB_FETCH_COST,
	DEFAULT_WEB_SEARCH_COST,
	normalizeBillingCurrencyCode,
	resolveAiDetectionConfig,
	resolveWebDeepSearchConfig,
	resolveWebFetchConfig,
	resolveWebSearchConfig,
} from '@octafuse/core';
import { Hono } from 'hono';
import type { Env } from '../../../app';
import { requireApiKey } from '../../../middleware/auth';

type ToolsEnv = Env & { Variables: { apiKey: import('../../../middleware/auth').ApiKeyContext } };

export const toolsPricingRoutes = new Hono<ToolsEnv>();

toolsPricingRoutes.use('*', requireApiKey);

type ToolPricingRow =
	| { id: string; unit: 'request'; cost: number }
	| { id: string; unit: 'chars'; unit_chars: number; cost: number };

toolsPricingRoutes.get('/', async (c) => {
	const repos = c.get('repositories');

	const [billingRaw, webSearch, webFetch, webDeepSearch, aiDetection] = await Promise.all([
		repos.systemConfig.getConfig(BILLING_CURRENCY_KEY),
		resolveWebSearchConfig(repos),
		resolveWebFetchConfig(repos),
		resolveWebDeepSearchConfig(repos),
		resolveAiDetectionConfig(repos),
	]);

	const tools: ToolPricingRow[] = [
		{
			id: 'web-search',
			unit: 'request',
			cost: webSearch.ok ? webSearch.config.cost : DEFAULT_WEB_SEARCH_COST,
		},
		{
			id: 'web-fetch',
			unit: 'request',
			cost: webFetch.ok ? webFetch.config.cost : DEFAULT_WEB_FETCH_COST,
		},
		{
			id: 'web-deep-search',
			unit: 'request',
			cost: webDeepSearch.ok ? webDeepSearch.config.cost : DEFAULT_WEB_DEEP_SEARCH_COST,
		},
		{
			id: 'ai-detection',
			unit: 'chars',
			unit_chars: aiDetection.ok
				? aiDetection.config.billingUnitChars
				: DEFAULT_AI_DETECTION_BILLING_UNIT_CHARS,
			cost: aiDetection.ok ? aiDetection.config.cost : DEFAULT_AI_DETECTION_COST,
		},
	];

	return c.json({
		data: {
			billing_currency: normalizeBillingCurrencyCode(billingRaw),
			tools,
		},
	});
});
