/**
 * Tools Service — Node.js 运行时入口。
 * 推荐部署形态：外部服务器 / Docker / VPS，承载 CPU 密集工具引擎。
 **/
import { serve } from '@hono/node-server';
import { pathToFileURL } from 'node:url';
import { createToolsApp } from '../app';

function readToken(): string | undefined {
	const t = process.env.TOOLS_SERVICE_TOKEN?.trim();
	return t || undefined;
}

function printBanner(port: number, tokenSet: boolean): void {
	const lines = [
		'',
		'────────────────────────────────────────────',
		'  Tools Service (Node)',
		`  Endpoint      : http://127.0.0.1:${port}`,
		`  Web Search    : POST /v1/tools/web-search`,
		`  Web Fetch     : POST /v1/tools/web-fetch`,
		`  Web Deep Src  : POST /v1/tools/web-deep-search`,
		`  AI Detection  : POST /v1/tools/ai-detection`,
		`  Health        : GET  /health`,
		`  Internal Auth : ${tokenSet ? 'TOOLS_SERVICE_TOKEN (on)' : 'off (no TOOLS_SERVICE_TOKEN)'}`,
		'────────────────────────────────────────────',
		'',
	];
	console.log(lines.join('\n'));
}

export function createNodeToolsApp() {
	return createToolsApp({ token: readToken() });
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
	const port = Number(process.env.PORT ?? 8899);
	const app = createNodeToolsApp();
	printBanner(port, Boolean(readToken()));
	serve({ fetch: app.fetch, port });
}