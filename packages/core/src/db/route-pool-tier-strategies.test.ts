import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	normalizeRoutePoolTierStrategiesInput,
	parseRoutePoolTierStrategies,
} from './route-pool-tier-strategies';

describe('parseRoutePoolTierStrategies', () => {
	it('returns empty map for null / empty / invalid JSON', () => {
		assert.equal(parseRoutePoolTierStrategies(null).size, 0);
		assert.equal(parseRoutePoolTierStrategies('').size, 0);
		assert.equal(parseRoutePoolTierStrategies('not json').size, 0);
		assert.equal(parseRoutePoolTierStrategies('[]').size, 0);
		assert.equal(parseRoutePoolTierStrategies('"cache_affinity"').size, 0);
	});

	it('parses valid priority → strategy map and ignores bad entries', () => {
		const map = parseRoutePoolTierStrategies(
			JSON.stringify({
				'10': 'cache_affinity',
				'0': 'fixed_order',
				bad: 'cache_affinity',
				'1.5': 'weighted_random',
				'2': 'nope',
				'3': 1,
			})
		);
		assert.equal(map.size, 2);
		assert.equal(map.get(10), 'cache_affinity');
		assert.equal(map.get(0), 'fixed_order');
	});

	it('accepts negative integer priorities', () => {
		const map = parseRoutePoolTierStrategies(JSON.stringify({ '-1': 'weighted_round_robin' }));
		assert.equal(map.get(-1), 'weighted_round_robin');
	});
});

describe('normalizeRoutePoolTierStrategiesInput', () => {
	it('returns null for empty / null / empty object', () => {
		assert.equal(normalizeRoutePoolTierStrategiesInput(null), null);
		assert.equal(normalizeRoutePoolTierStrategiesInput(''), null);
		assert.equal(normalizeRoutePoolTierStrategiesInput('{}'), null);
		assert.equal(normalizeRoutePoolTierStrategiesInput({}), null);
	});

	it('normalizes object and string inputs', () => {
		assert.equal(
			normalizeRoutePoolTierStrategiesInput({ '10': 'cache_affinity', '0': 'fixed_order' }),
			JSON.stringify({ '10': 'cache_affinity', '0': 'fixed_order' })
		);
		assert.equal(
			normalizeRoutePoolTierStrategiesInput('{"10":"cache_affinity"}'),
			JSON.stringify({ '10': 'cache_affinity' })
		);
	});

	it('throws on invalid key or strategy', () => {
		assert.throws(
			() => normalizeRoutePoolTierStrategiesInput({ foo: 'cache_affinity' }),
			/integer priority/
		);
		assert.throws(
			() => normalizeRoutePoolTierStrategiesInput({ '1': 'sticky' }),
			/must be one of/
		);
		assert.throws(
			() => normalizeRoutePoolTierStrategiesInput('not json'),
			/valid JSON/
		);
	});
});
