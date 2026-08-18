/**
 * Tools Service — 独立工具引擎 HTTP 服务。
 *
 * 将 CPU 密集 / 长耗时工具（web-search、web-fetch、web-deep-search、ai-detection）
 * 从 Gateway Worker 中剥离，部署为：
 *   - Node.js 外部服务器（推荐，`src/runtime/node.ts`，Docker / VPS）
 *   - Cloudflare Worker / Pages Functions（`src/runtime/worker.ts`，`_worker.js` advanced mode）
 *
 * 服务无数据库依赖、无状态；Proxy 通过 HTTP 委托执行并自行完成鉴权 / 计费。
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { aiDetectionRoutes } from './routes/ai-detection';
import { webDeepSearchRoutes } from './routes/web-deep-search';
import { webFetchRoutes } from './routes/web-fetch';
import { webSearchRoutes } from './routes/web-search';
import { TOOLS_SERVICE_VERSION } from './version';

export type ToolsServiceEnv = {
	Bindings: {
		/** 可选：调用方需携带 `Authorization: Bearer <TOOLS_SERVICE_TOKEN>`；未配置则放行。 */
		TOOLS_SERVICE_TOKEN?: string;
	};
};

/** 校验可选内部令牌；未配置 TOOLS_SERVICE_TOKEN 时跳过校验（默认内网部署）。 */
export function createToolsApp(options?: { token?: string }): Hono<ToolsServiceEnv> {
	const app = new Hono<ToolsServiceEnv>();
	const token = options?.token;

	app.use('*', logger());
	app.use(
		'*',
		cors({
			origin: '*',
			allowMethods: ['GET', 'POST', 'OPTIONS'],
			allowHeaders: ['Content-Type', 'Authorization'],
		})
	);

	if (token) {
		app.use('*', async (c, next) => {
			const auth = c.req.header('authorization') ?? '';
			if (auth !== `Bearer ${token}`) {
				return c.json({ error: 'Unauthorized' }, 401);
			}
			await next();
		});
	}

	app.get('/health', (c) =>
		c.json({
			ok: true,
			service: 'tools-service',
			version: TOOLS_SERVICE_VERSION,
		})
	);

	app.route('/v1/tools/web-search', webSearchRoutes);
	app.route('/v1/tools/web-fetch', webFetchRoutes);
	app.route('/v1/tools/web-deep-search', webDeepSearchRoutes);
	app.route('/v1/tools/ai-detection', aiDetectionRoutes);

	return app;
}
