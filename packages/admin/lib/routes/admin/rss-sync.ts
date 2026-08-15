/**
 * 管理路由：`/admin/rss-sync` — 从 ModelRadar RSS 拉取并同步免费模型。
 * 手动触发（POST /admin/rss-sync/run）。
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireMasterKey } from '@/lib/middleware/admin-auth';
import { syncFreeModelsFromRss, getRssSyncDue, DEFAULT_RSS_URL } from '@/lib/services/admin/rss-sync-service';
import { createWorkersAiClassifier } from '@/lib/services/admin/workers-ai-classifier';
import { handleAdminRouteError } from './error-response';

export const adminRssSyncRoutes = new Hono<AdminEnv>();

adminRssSyncRoutes.use('*', requireMasterKey);

/** 查询上次同步时间与是否到期（用于前端自动触发与按钮状态）。 */
adminRssSyncRoutes.get('/status', async (c) => {
	try {
		const repos = c.get('repositories');
		const { lastSyncAt, due } = await getRssSyncDue(repos);
		return c.json({
			success: true,
			source: c.env?.RSS_SYNC_URL || DEFAULT_RSS_URL,
			last_sync_at: lastSyncAt,
			due,
		});
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to read RSS sync status');
	}
});

/** 手动触发一次同步。body 可选 `{ url }` 覆盖默认 RSS 源；否则用 `RSS_SYNC_URL` 环境变量或默认源。 */
adminRssSyncRoutes.post('/run', async (c) => {
	let url = c.env?.RSS_SYNC_URL || DEFAULT_RSS_URL;
	try {
		const raw = await c.req.json();
		const candidate = (raw as { url?: unknown })?.url;
		if (typeof candidate === 'string' && candidate.trim() !== '') {
			url = candidate.trim();
		}
	} catch {
		// 无 body 或非 JSON：使用环境变量/默认源
	}
	try {
		const repos = c.get('repositories');
		// Workers AI 智能归类：优先 env.AI binding，其次 CF_API_TOKEN + CF_ACCOUNT_ID REST 通道
		const aiClassifier = createWorkersAiClassifier({
			AI: c.env?.AI,
			CF_API_TOKEN: c.env?.CF_API_TOKEN,
			CF_ACCOUNT_ID: c.env?.CF_ACCOUNT_ID,
		});
		const data = await syncFreeModelsFromRss(repos, url, aiClassifier);
		const parts = [
			`${data.models_created} created`,
			`${data.routes_created} routes`,
			`${data.models_no_provider} skipped (no provider key)`,
			`${data.models_skipped_unsupported} skipped (unsupported type)`,
		];
		if (data.models_skipped_video > 0) {
			parts.push(`${data.models_skipped_video} video models (gateway doesn't support video yet)`);
		}
		if (data.failed.length > 0) {
			parts.push(`${data.failed.length} failed`);
		}
		return c.json({
			success: true,
			message: `RSS sync finished: ${parts.join(', ')}.`,
			data,
		});
	} catch (error) {
		return handleAdminRouteError(c, error, 'Failed to sync free models from RSS');
	}
});
