import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RouteResult } from './model-router';
import { buildRouteAttemptPlan } from './route-attempt-planner';
import { markProviderFailure, resetProviderCircuitStateForTests } from './provider-circuit-breaker';
import { resetRoundRobinStateForTests } from './route-strategies';

function makeRoute(providerId: string, overrides: Partial<RouteResult> = {}): RouteResult {
	return {
		providerId,
		providerName: providerId,
		providerModelName: 'model-x',
		upstreamProtocol: 'openai',
		providerEndpoints: { openai: { base: 'https://example.com/v1' } },
		providerApiKey: `sk-${providerId}`,
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: null,
		routeGroup: 'default',
		routePriority: 0,
		routeWeight: 1,
		providerKeyId: providerId,
		providerKeyLabel: providerId,
		providerKeyFingerprint: `…${providerId.slice(-4)}`,
		...overrides,
	};
}

beforeEach(() => {
	resetProviderCircuitStateForTests();
	resetRoundRobinStateForTests();
});

describe('buildRouteAttemptPlan', () => {
	it('orders higher priority tiers first', () => {
		const routes = [
			makeRoute('low', { routePriority: 1 }),
			makeRoute('high', { routePriority: 10 }),
		];
		const plan = buildRouteAttemptPlan(
			routes,
			{ affinityKey: 'u|m|default|openai', tierKeyPrefix: 'm|default|openai' },
			'strict'
		);
		assert.deepEqual(
			plan.attempts.map((r) => r.providerId),
			['high', 'low']
		);
	});

	it('skips circuit-open providers and tracks earliest retry', () => {
		const t0 = 1_000_000;
		markProviderFailure('p1', 'rate_limit', 8_000, t0);
		const routes = [makeRoute('p1'), makeRoute('p2')];
		const plan = buildRouteAttemptPlan(
			routes,
			{ affinityKey: 'u|m|default|openai', tierKeyPrefix: 'm|default|openai' },
			'strict',
			t0
		);
		assert.deepEqual(
			plan.attempts.map((r) => r.providerId),
			['p2']
		);
		assert.equal(plan.skippedByCircuit, 1);
		assert.equal(plan.earliestRetryAfterMs, 8_000);
	});

	it('returns empty attempts when all providers are circuit-open', () => {
		const t0 = 1_000_000;
		markProviderFailure('p1', 'rate_limit', 5_000, t0);
		const plan = buildRouteAttemptPlan(
			[makeRoute('p1')],
			{ affinityKey: 'u|m|default|openai', tierKeyPrefix: 'm|default|openai' },
			'affinity',
			t0
		);
		assert.equal(plan.attempts.length, 0);
		assert.equal(plan.skippedByCircuit, 1);
		assert.equal(plan.earliestRetryAfterMs, 5_000);
	});

	it('applies strict ordering within a tier by weight then providerId', () => {
		const routes = [
			makeRoute('b', { routeWeight: 1 }),
			makeRoute('a', { routeWeight: 5 }),
			makeRoute('c', { routeWeight: 5 }),
		];
		const plan = buildRouteAttemptPlan(
			routes,
			{ affinityKey: 'u|m|default|openai', tierKeyPrefix: 'm|default|openai' },
			'strict'
		);
		assert.deepEqual(
			plan.attempts.map((r) => r.providerId),
			['a', 'c', 'b']
		);
	});
});
