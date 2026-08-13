/**
 * Web Fetch 共享 HTTP 工具：请求超时 + 响应体大小上限。
 * 修复：所有提供商裸 `fetch` 无 AbortSignal/超时，且缓冲整个响应体，
 * 挂起提供商可无限期持有 Worker，恶意/大页面可返回无限制 markdown（成本/DoS 放大）。
 */

import { WebFetchProviderError } from './types';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MiB

export type BoundedFetchOptions = {
	/** 提供商标识，用于错误信息 */
	provider: string;
	/** 请求超时（含响应体读取），默认 30s */
	timeoutMs?: number;
	/** 响应体最大字节数，默认 5 MiB */
	maxResponseBytes?: number;
};

/**
 * 带超时 + 大小上限的 fetch。
 * 返回 `{ response, text }`：`text` 为已按上限读取的响应体文本。
 * 超时抛 DOMException('AbortError')；超限抛 WebFetchProviderError(502)。
 */
export async function fetchBoundedText(
	fetchImpl: typeof fetch,
	url: string,
	init: RequestInit,
	options: BoundedFetchOptions
): Promise<{ response: Response; text: string }> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(new DOMException('Web fetch timed out', 'AbortError')),
		timeoutMs
	);

	const externalSignal = init.signal;
	let onExternalAbort: (() => void) | null = null;
	if (externalSignal) {
		if (externalSignal.aborted) {
			clearTimeout(timer);
			throw externalSignal.reason ?? new DOMException('Aborted', 'AbortError');
		}
		onExternalAbort = () =>
			controller.abort(externalSignal.reason ?? new DOMException('Aborted', 'AbortError'));
		externalSignal.addEventListener('abort', onExternalAbort, { once: true });
	}

	try {
		const response = await fetchImpl(url, { ...init, signal: controller.signal });
		const text = await readBoundedBody(response, maxBytes, options.provider, controller.signal);
		return { response, text };
	} finally {
		clearTimeout(timer);
		if (externalSignal && onExternalAbort) {
			externalSignal.removeEventListener('abort', onExternalAbort);
		}
	}
}

async function readBoundedBody(
	response: Response,
	maxBytes: number,
	provider: string,
	signal: AbortSignal
): Promise<string> {
	if (!response.body) {
		return await response.text();
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder('utf-8');
	const chunks: string[] = [];
	let total = 0;
	for (;;) {
		if (signal.aborted) {
			throw signal.reason ?? new DOMException('Aborted', 'AbortError');
		}
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new WebFetchProviderError(
				`Response exceeded size limit (${maxBytes} bytes)`,
				502,
				provider
			);
		}
		chunks.push(decoder.decode(value, { stream: true }));
	}
	chunks.push(decoder.decode());
	return chunks.join('');
}
