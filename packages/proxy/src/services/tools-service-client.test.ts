import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
	createToolsServiceClient,
	resetToolsServicePrimaryCircuitForTests,
	resetToolsServiceSelfHealForTests,
	type ToolsServiceConfig,
} from './tools-service-client';

const PRIMARY = 'https://render.example.com';
const FALLBACK = 'https://cf.example.com';

function makeCfg(overrides: Partial<ToolsServiceConfig> = {}): ToolsServiceConfig {
	return {
		primary: { baseUrl: PRIMARY, token: 'tok' },
		fallback: { baseUrl: FALLBACK, token: 'tok' },
		...overrides,
	};
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

/** 记录每次 fetch 的 URL，便于断言走了哪个端点。 */
function trackFetch(calls: string[]): void {
	mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
		calls.push(String(input));
		return jsonResponse(200, { results: [] });
	});
}

beforeEach(() => {
	resetToolsServicePrimaryCircuitForTests();
	resetToolsServiceSelfHealForTests();
	mock.restoreAll();
});

describe('tools-service-client — dual endpoint auto-failover', () => {
	it('uses primary endpoint when it succeeds', async () => {
		const calls: string[] = [];
		trackFetch(calls);
		const client = createToolsServiceClient(makeCfg());

		const results = await client.webSearch('google', {
			apiKey: 'k',
			query: 'q',
			count: 3,
			allowedDomains: [],
			blockedDomains: [],
		});

		assert.deepEqual(results, []);
		assert.equal(calls.length, 1);
		assert.ok(calls[0]!.startsWith(PRIMARY));
	});

	it('falls back to fallback endpoint when primary returns 5xx', async () => {
		const calls: string[] = [];
		mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
			calls.push(String(input));
			if (String(input).startsWith(PRIMARY)) {
				return jsonResponse(503, { error: 'cold start' });
			}
			return jsonResponse(200, { results: [] });
		});
		const client = createToolsServiceClient(makeCfg());

		const results = await client.webSearch('google', {
			apiKey: 'k',
			query: 'q',
			count: 3,
			allowedDomains: [],
			blockedDomains: [],
		});

		assert.deepEqual(results, []);
		assert.equal(calls.length, 2);
		assert.ok(calls[0]!.startsWith(PRIMARY));
		assert.ok(calls[1]!.startsWith(FALLBACK));
	});

	it('falls back to fallback endpoint when primary throws (network error)', async () => {
		const calls: string[] = [];
		mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
			calls.push(String(input));
			if (String(input).startsWith(PRIMARY)) {
				throw new TypeError('fetch failed: DNS resolution error');
			}
			return jsonResponse(200, { results: [] });
		});
		const client = createToolsServiceClient(makeCfg());

		const results = await client.webSearch('google', {
			apiKey: 'k',
			query: 'q',
			count: 3,
			allowedDomains: [],
			blockedDomains: [],
		});

		assert.deepEqual(results, []);
		assert.equal(calls.length, 2);
		assert.ok(calls[0]!.startsWith(PRIMARY));
		assert.ok(calls[1]!.startsWith(FALLBACK));
	});

	it('does NOT fall back on 4xx client errors', async () => {
		const calls: string[] = [];
		mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
			calls.push(String(input));
			if (String(input).startsWith(PRIMARY)) {
				return jsonResponse(400, { error: 'bad request' });
			}
			return jsonResponse(200, { results: [] });
		});
		const client = createToolsServiceClient(makeCfg());

		await assert.rejects(
			client.webSearch('google', {
				apiKey: 'k',
				query: 'q',
				count: 3,
				allowedDomains: [],
				blockedDomains: [],
			})
		);
		assert.equal(calls.length, 1);
		assert.ok(calls[0]!.startsWith(PRIMARY));
	});

	it('enters cooldown after threshold failures and uses fallback directly', async () => {
		const calls: string[] = [];
		mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
			calls.push(String(input));
			if (String(input).startsWith(PRIMARY)) {
				return jsonResponse(503, { error: 'cold start' });
			}
			return jsonResponse(200, { results: [] });
		});
		const client = createToolsServiceClient(makeCfg());
		const params = {
			apiKey: 'k',
			query: 'q',
			count: 3,
			allowedDomains: [],
			blockedDomains: [],
		};

		// 连续 3 次失败触发冷却（每次都会先试主端点再回退）
		for (let i = 0; i < 3; i += 1) {
			await client.webSearch('google', params);
		}
		assert.equal(calls.length, 6); // 3 次 × (primary + fallback)

		// 冷却期内：直接走 fallback，不再请求 primary
		await client.webSearch('google', params);
		assert.equal(calls.length, 7);
		assert.ok(calls[6]!.startsWith(FALLBACK));
	});

	it('recovers primary after cooldown expires', async () => {
		const calls: string[] = [];
		mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
			calls.push(String(input));
			if (String(input).startsWith(PRIMARY)) {
				return jsonResponse(503, { error: 'cold start' });
			}
			return jsonResponse(200, { results: [] });
		});
		const client = createToolsServiceClient(makeCfg());
		const params = {
			apiKey: 'k',
			query: 'q',
			count: 3,
			allowedDomains: [],
			blockedDomains: [],
		};

		// 触发冷却
		for (let i = 0; i < 3; i += 1) {
			await client.webSearch('google', params);
		}
		const before = calls.length;

		// 模拟冷却期结束（重置状态 = 冷却过期后自动恢复探测）
		resetToolsServicePrimaryCircuitForTests();

		// 主端点恢复：直接成功，不再回退
		mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
			calls.push(String(input));
			return jsonResponse(200, { results: [] });
		});
		await client.webSearch('google', params);
		assert.equal(calls.length, before + 1);
		assert.ok(calls[before]!.startsWith(PRIMARY));
	});
});

describe('tools-service-client — self-heal redeploy on fallback failure', () => {
	const params = {
		apiKey: 'k',
		query: 'q',
		count: 3,
		allowedDomains: [],
		blockedDomains: [],
	};

	function makeSelfHealCfg(): ToolsServiceConfig {
		return makeCfg({
			selfHeal: {
				githubToken: 'ghp_test',
				repo: 'owner/repo',
				workflowFile: 'deploy-tools-service.yml',
				cooldownMs: 300_000,
			},
		});
	}

	it('dispatches GitHub workflow when both primary and fallback fail', async () => {
		const dispatchUrls: string[] = [];
		mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('https://api.github.com/')) {
				dispatchUrls.push(url);
				return jsonResponse(204, {});
			}
			return jsonResponse(503, { error: 'unavailable' });
		});
		const client = createToolsServiceClient(makeSelfHealCfg());

		await assert.rejects(client.webSearch('google', params));
		// 自愈 dispatch 是 fire-and-forget 异步调用，等待其完成
		await new Promise((r) => setTimeout(r, 10));

		assert.equal(dispatchUrls.length, 1);
		assert.ok(
			dispatchUrls[0]!.includes(
				'/repos/owner/repo/actions/workflows/deploy-tools-service.yml/dispatches'
			)
		);
	});

	it('does NOT dispatch when fallback succeeds (self-heal not needed)', async () => {
		const dispatchUrls: string[] = [];
		mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('https://api.github.com/')) {
				dispatchUrls.push(url);
				return jsonResponse(204, {});
			}
			if (url.startsWith(PRIMARY)) {
				return jsonResponse(503, { error: 'cold start' });
			}
			return jsonResponse(200, { results: [] });
		});
		const client = createToolsServiceClient(makeSelfHealCfg());

		const results = await client.webSearch('google', params);
		assert.deepEqual(results, []);
		assert.equal(dispatchUrls.length, 0);
	});

	it('respects cooldown: only dispatches once within cooldown window', async () => {
		const dispatchUrls: string[] = [];
		mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('https://api.github.com/')) {
				dispatchUrls.push(url);
				return jsonResponse(204, {});
			}
			return jsonResponse(503, { error: 'unavailable' });
		});
		const client = createToolsServiceClient(makeSelfHealCfg());

		// 连续多次失败，冷却期内只应触发一次 dispatch
		for (let i = 0; i < 5; i += 1) {
			await assert.rejects(client.webSearch('google', params));
		}
		// 自愈 dispatch 是 fire-and-forget 异步调用，等待其完成
		await new Promise((r) => setTimeout(r, 10));

		assert.equal(dispatchUrls.length, 1);
	});

	it('does NOT dispatch when self-heal is not configured', async () => {
		const dispatchUrls: string[] = [];
		mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.startsWith('https://api.github.com/')) {
				dispatchUrls.push(url);
				return jsonResponse(204, {});
			}
			return jsonResponse(503, { error: 'unavailable' });
		});
		const client = createToolsServiceClient(makeCfg());

		await assert.rejects(client.webSearch('google', params));
		assert.equal(dispatchUrls.length, 0);
	});
});
