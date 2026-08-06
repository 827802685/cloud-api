import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { GatewayRepositories } from '@octafuse/core';
import { resetRouteStrategyCacheForTests } from '@octafuse/core';
import type { RouteResult } from '../model-router';
import {
	buildAffinityKey,
	buildTierKeyPrefix,
	resolveRouteStrategy,
	routeAffinityScore,
	ROUTE_STRATEGIES,
	resetRoundRobinStateForTests,
} from './index';

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
		...overrides,
	};
}

function mockRepos(globalStrategy: string | null): GatewayRepositories {
	return {
		systemConfig: {
			getConfig: async () => globalStrategy,
		},
	} as GatewayRepositories;
}

beforeEach(() => {
	resetRouteStrategyCacheForTests();
	resetRoundRobinStateForTests();
});

describe('buildAffinityKey / buildTierKeyPrefix', () => {
	it('builds stable keys without capability', () => {
		assert.equal(buildAffinityKey('u1', 'gpt', 'default', 'openai'), 'u1|gpt|default|openai');
		assert.equal(buildTierKeyPrefix('gpt', 'free', 'gemini'), 'gpt|free|gemini');
	});
});

describe('affinity ordering', () => {
	it('is deterministic for the same affinityKey', () => {
		const routes = [makeRoute('p-a'), makeRoute('p-b'), makeRoute('p-c', { routeWeight: 3 })];
		const ctx = { affinityKey: 'user|model|default|openai', tierKey: 'model|default|openai|0' };
		const a = ROUTE_STRATEGIES.affinity(routes, ctx);
		const b = ROUTE_STRATEGIES.affinity(routes, ctx);
		assert.deepEqual(
			a.map((r) => r.providerId),
			b.map((r) => r.providerId)
		);
		const scores = a.map((r) => routeAffinityScore(ctx.affinityKey, r.providerId, r.routeWeight));
		for (let i = 1; i < scores.length; i++) {
			assert.ok(scores[i - 1]! >= scores[i]!);
		}
	});

	it('prefers higher weight when hashes are otherwise comparable via score formula', () => {
		const score1 = routeAffinityScore('k', 'provider', 1);
		const score5 = routeAffinityScore('k', 'provider', 5);
		assert.ok(score5 > score1);
		assert.equal(score5 / score1, 5);
	});
});

describe('resolveRouteStrategy five-level', () => {
	it('uses capability rule over protocol / model / global', async () => {
		const raw = JSON.stringify({
			strategy: 'affinity',
			rules: {
				'openai:default': { strategy: 'weighted_random' },
				'openai.chat:default': { strategy: 'strict' },
			},
		});
		const strategy = await resolveRouteStrategy({
			routePolicyRaw: raw,
			protocol: 'openai',
			capability: 'chat',
			routeGroup: 'default',
			repos: mockRepos('round_robin'),
		});
		assert.equal(strategy, 'strict');
	});

	it('falls back to protocol rule then model strategy then global', async () => {
		const raw = JSON.stringify({
			strategy: 'affinity',
			rules: {
				'openai:default': { strategy: 'weighted_random' },
			},
		});
		assert.equal(
			await resolveRouteStrategy({
				routePolicyRaw: raw,
				protocol: 'openai',
				capability: 'images.generations',
				routeGroup: 'default',
				repos: mockRepos('round_robin'),
			}),
			'weighted_random'
		);
		assert.equal(
			await resolveRouteStrategy({
				routePolicyRaw: JSON.stringify({ strategy: 'strict' }),
				protocol: 'anthropic',
				capability: 'messages',
				routeGroup: 'default',
				repos: mockRepos('round_robin'),
			}),
			'strict'
		);
		resetRouteStrategyCacheForTests();
		assert.equal(
			await resolveRouteStrategy({
				routePolicyRaw: null,
				protocol: 'openai',
				capability: 'chat',
				routeGroup: 'default',
				repos: mockRepos('round_robin'),
			}),
			'round_robin'
		);
		resetRouteStrategyCacheForTests();
		assert.equal(
			await resolveRouteStrategy({
				routePolicyRaw: null,
				protocol: 'openai',
				capability: 'chat',
				routeGroup: 'default',
				repos: mockRepos(null),
			}),
			'affinity'
		);
	});

	it('aliases both legacy Gemini capability rules onto models.generate (generateContent wins)', async () => {
		const raw = JSON.stringify({
			rules: {
				'gemini.streamGenerateContent:default': { strategy: 'weighted_random' },
				'gemini.generateContent:default': { strategy: 'strict' },
			},
		});
		const gen = await resolveRouteStrategy({
			routePolicyRaw: raw,
			protocol: 'gemini',
			capability: 'models.generate',
			routeGroup: 'default',
			repos: mockRepos('affinity'),
		});
		const streamAlias = await resolveRouteStrategy({
			routePolicyRaw: raw,
			protocol: 'gemini',
			capability: 'streamGenerateContent',
			routeGroup: 'default',
			repos: mockRepos('affinity'),
		});
		assert.equal(gen, 'strict');
		assert.equal(streamAlias, 'strict');
	});

	it('keeps same affinity order for generateContent and streamGenerateContent when policy is shared', async () => {
		const routes = [makeRoute('g1'), makeRoute('g2'), makeRoute('g3')];
		const affinityKey = buildAffinityKey('u', 'gemini-pro', 'default', 'gemini');
		const ctx = { affinityKey, tierKey: `${buildTierKeyPrefix('gemini-pro', 'default', 'gemini')}|0` };
		const orderGen = ROUTE_STRATEGIES.affinity(routes, ctx).map((r) => r.providerId);
		const orderStream = ROUTE_STRATEGIES.affinity(routes, ctx).map((r) => r.providerId);
		assert.deepEqual(orderGen, orderStream);
	});
});
