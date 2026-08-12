/**
 * Gateway API 代理：`/api/v1/*` → 内部重写为 `/v1/*` 后交给 Proxy Hono 应用。
 * 与 `/api/admin/*` 类似，但走 Proxy 路由（含 API Key 鉴权、模型路由、failover 等）。
 *
 * 前端调用方式：
 * - 浏览器：`fetch('/api/v1/chat/completions', { ... })`
 * - 外部客户端：`fetch('https://<worker>/api/v1/chat/completions', { headers: { 'Authorization': 'Bearer sk-...' } })`
 */
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { AdminBindings } from '@/lib/admin-env';
import { getCloudflareEnv } from '@/lib/cloudflare';
import { resolveAdminStorageContext } from '@/lib/storage-context';
import { getProxyApp } from '@/lib/proxy-app';

export const dynamic = 'force-dynamic';

interface RequestWithCloudflare extends Request {
	ctx?: {
		cloudflare?: {
			env?: CloudflareEnv;
		};
	};
	env?: CloudflareEnv;
}

/** 将 `/api/v1/*` 重写为 `/v1/*`，交给 Proxy Hono 应用处理。 */
function rewriteToProxyPath(request: Request): Request {
	const u = new URL(request.url);
	const prefix = '/api/v1';
	if (!u.pathname.startsWith(prefix)) {
		return request;
	}
	const rest = u.pathname.slice(prefix.length);
	u.pathname = '/v1' + (rest === '' ? '' : rest);
	return new Request(u.toString(), request);
}

function isCloudflareRuntime(
	request: Request,
	hasCloudflareContext: boolean,
	env?: CloudflareEnv
): boolean {
	if (hasCloudflareContext) {
		return true;
	}
	if (env?.DB || env?.ASSETS) {
		return true;
	}
	const reqWithCf = request as RequestWithCloudflare;
	if (reqWithCf.ctx?.cloudflare?.env || reqWithCf.env?.DB || reqWithCf.env?.ASSETS) {
		return true;
	}
	return false;
}

async function handle(request: Request): Promise<Response> {
	try {
		let env: CloudflareEnv | undefined;
		let ctx: ExecutionContext | undefined;
		let hasCloudflareContext = false;
		try {
			const cf = getCloudflareContext();
			env = cf.env as CloudflareEnv;
			ctx = cf.ctx;
			hasCloudflareContext = true;
		} catch {
			env = getCloudflareEnv(request);
		}

		const cloudflareRuntime = isCloudflareRuntime(request, hasCloudflareContext, env);
		if (cloudflareRuntime && !env?.DB) {
			return Response.json(
				{
					success: false,
					message:
						'Cloudflare runtime requires D1 binding `DB`. For Node/self-hosted deployment, run with DATABASE_URL outside Cloudflare.',
				},
				{ status: 500 }
			);
		}

		const runtimeBindings: AdminBindings = {
			DB: env?.DB,
			ASSETS: env?.ASSETS,
			DATABASE_URL: cloudflareRuntime ? undefined : process.env.DATABASE_URL,
			DATABASE_DRIVER: cloudflareRuntime
				? (env as { DATABASE_DRIVER?: string } | undefined)?.DATABASE_DRIVER
				: process.env.DATABASE_DRIVER,
		};
		const storage = await resolveAdminStorageContext(
			runtimeBindings,
			cloudflareRuntime ? 'cloudflare' : 'node'
		);

		const internalReq = rewriteToProxyPath(request);
		const app = getProxyApp();
		const appBindings: AdminBindings = {
			...runtimeBindings,
			STORAGE_CONTEXT: storage,
		};
		if (ctx) {
			return app.fetch(internalReq, appBindings, ctx);
		}
		return app.fetch(internalReq, appBindings);
	} catch (error) {
		console.error('[Gateway Proxy] Unhandled error:', {
			message: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});
		return Response.json(
			{
				error: 'Internal server error',
				message: error instanceof Error ? error.message : String(error),
			},
			{ status: 500 }
		);
	}
}

export const GET = (request: Request) => handle(request);
export const POST = (request: Request) => handle(request);
export const PUT = (request: Request) => handle(request);
export const PATCH = (request: Request) => handle(request);
export const DELETE = (request: Request) => handle(request);
export const OPTIONS = (request: Request) => handle(request);
