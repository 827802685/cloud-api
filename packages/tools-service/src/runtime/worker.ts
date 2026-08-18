/**
 * Tools Service — Cloudflare 边缘运行时入口。
 * 用于将工具引擎部署为独立 Worker 或 Cloudflare Pages Functions（`_worker.js`，advanced mode）。
 * 两种形态同属 Workers runtime，但 Pages 使用独立资源 / 域名预算，可将工具负载从网关 Worker 中移出。
 * 若需更宽余的 CPU 时长，建议使用 Node 运行时（Docker / VPS）。
 **/
import { createToolsApp } from '../app';

export default {
	async fetch(request: Request, env: { TOOLS_SERVICE_TOKEN?: string }) {
		const token = env.TOOLS_SERVICE_TOKEN?.trim() || undefined;
		const app = createToolsApp({ token });
		return app.fetch(request, env);
	},
};