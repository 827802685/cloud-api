/**
 * 管理路由：`/admin/playground` — 管理员试调用。
 * - routeId 分支：直连单条 model_routes 上游（不计费、不写 logs、无 failover）
 * - toolId 分支：读 system_config catalog 直连工具引擎（可测非 Active；不计费、不写 logs）
 */
import { Hono } from 'hono';
import type { AdminEnv } from '@/lib/admin-env';
import { requireMasterKey } from '@/lib/middleware/admin-auth';
import type { GeminiContentAction } from '@cloud-api/core/gemini-upstream-url';
import type { ImageOperation } from '@/lib/image-generations';
import { invokePlaygroundUpstream } from '@/lib/services/admin/playground-service';
import { invokePlaygroundTool } from '@/lib/services/admin/playground-tools-service';
import { sanitizeJsonResponseText, sanitizeSseDataLine } from '@cloud-api/proxy';
import { handleAdminRouteError } from './error-response';

export const adminPlaygroundRoutes = new Hono<AdminEnv>();

adminPlaygroundRoutes.use('*', requireMasterKey);

/**
 * 透传上游响应体时净化内部元数据字段（`extra_content` / `thought_signature` 等）。
 * - `text/event-stream`：逐行净化 `data:` JSON。
 * - `application/json`：整体解析净化后重序列化。
 * - 其他（text/audio/image）：原样透传。
 * 净化失败时回退原样，绝不破坏响应。
 */
function sanitizeResponseBodyStream(
	body: ReadableStream<Uint8Array> | null,
	contentType: string
): ReadableStream<Uint8Array> | null {
	if (!body) return null;
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	if (contentType.includes('text/event-stream')) {
		return new ReadableStream<Uint8Array>({
			async start(controller) {
				const reader = body.getReader();
				let buffer = '';
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split('\n');
						buffer = lines.pop() ?? '';
						for (const line of lines) {
							controller.enqueue(encoder.encode(sanitizeSseDataLine(line) + '\n'));
						}
					}
					if (buffer) {
						controller.enqueue(encoder.encode(sanitizeSseDataLine(buffer) + '\n'));
					}
				} catch (e) {
					controller.error(e);
				} finally {
					reader.releaseLock();
					controller.close();
				}
			},
		});
	}

	if (contentType.includes('application/json')) {
		return new ReadableStream<Uint8Array>({
			async start(controller) {
				const reader = body.getReader();
				let acc = '';
				try {
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						acc += decoder.decode(value, { stream: true });
					}
					acc += decoder.decode();
					controller.enqueue(encoder.encode(sanitizeJsonResponseText(acc)));
				} catch (e) {
					controller.error(e);
				} finally {
					reader.releaseLock();
					controller.close();
				}
			},
		});
	}

	return body;
}

type PlaygroundPostBody = {
	routeId?: unknown;
	toolId?: unknown;
	provider?: unknown;
	body?: unknown;
	geminiAction?: unknown;
	imageOperation?: unknown;
};

adminPlaygroundRoutes.post('/', async (c) => {
	let parsed: PlaygroundPostBody;
	try {
		parsed = (await c.req.json()) as PlaygroundPostBody;
	} catch {
		return c.json({ success: false as const, message: 'Invalid JSON body' }, 400);
	}

	const rawBody = parsed.body;
	if (rawBody == null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
		return c.json({ success: false as const, message: 'body must be a JSON object' }, 400);
	}

	const toolId = typeof parsed.toolId === 'string' ? parsed.toolId.trim() : '';
	const routeId = typeof parsed.routeId === 'string' ? parsed.routeId.trim() : '';

	if (toolId && routeId) {
		return c.json(
			{ success: false as const, message: 'Provide either routeId or toolId, not both' },
			400
		);
	}

	if (toolId) {
		const provider = typeof parsed.provider === 'string' ? parsed.provider : '';
		try {
			const { response, upstreamUrlForHeader, latencyMs, upstreamWireBodyJson } =
				await invokePlaygroundTool(
					c.get('repositories'),
					{
						toolId,
						provider,
						body: rawBody as Record<string, unknown>,
					},
					c.req.raw.signal
				);

			const headers = new Headers(response.headers);
			headers.set('x-playground-latency-ms', String(latencyMs));
			headers.set('x-playground-upstream-status', String(response.status));
			headers.set('x-playground-upstream-url', upstreamUrlForHeader);
			headers.set('x-playground-request-body', encodeURIComponent(upstreamWireBodyJson));
			headers.set('x-playground-mode', 'tool');

			const ct = headers.get('Content-Type') ?? '';
			return new Response(sanitizeResponseBodyStream(response.body, ct), {
				status: response.status,
				statusText: response.statusText,
				headers,
			});
		} catch (error) {
			return handleAdminRouteError(c, error, 'Playground tool invoke failed');
		}
	}

	if (!routeId) {
		return c.json(
			{ success: false as const, message: 'routeId or toolId is required' },
			400
		);
	}

	let geminiAction: GeminiContentAction | undefined;
	if (parsed.geminiAction === 'generateContent' || parsed.geminiAction === 'streamGenerateContent') {
		geminiAction = parsed.geminiAction;
	} else if (parsed.geminiAction != null && parsed.geminiAction !== '') {
		return c.json(
			{ success: false as const, message: 'geminiAction must be generateContent or streamGenerateContent' },
			400
		);
	}

	let imageOperation: ImageOperation | undefined;
	if (parsed.imageOperation === 'generations' || parsed.imageOperation === 'edits') {
		imageOperation = parsed.imageOperation;
	} else if (parsed.imageOperation != null && parsed.imageOperation !== '') {
		return c.json(
			{ success: false as const, message: 'imageOperation must be generations or edits' },
			400
		);
	}

	try {
		const { response, upstreamUrlForHeader, latencyMs, upstreamWireBodyJson } =
			await invokePlaygroundUpstream(
				c.get('repositories'),
				{
					routeId,
					body: rawBody as Record<string, unknown>,
					geminiAction,
					imageOperation,
				},
				c.req.raw.signal
			);

		const headers = new Headers(response.headers);
		headers.set('x-playground-latency-ms', String(latencyMs));
		headers.set('x-playground-upstream-status', String(response.status));
		headers.set('x-playground-upstream-url', upstreamUrlForHeader);
		headers.set('x-playground-request-body', encodeURIComponent(upstreamWireBodyJson));
		headers.set('x-playground-mode', 'route');

		const ct = headers.get('Content-Type') ?? '';
		return new Response(sanitizeResponseBodyStream(response.body, ct), {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	} catch (error) {
		return handleAdminRouteError(c, error, 'Playground invoke failed');
	}
});
