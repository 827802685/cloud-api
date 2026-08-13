import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreParams, scoreContext, scoreFreeQuota, scoreModelQuality } from './model-quality-scorer';

describe('model-quality-scorer', () => {
	it('scores params on a log scale', () => {
		assert.ok(scoreParams(0) > 0);
		assert.ok(scoreParams(1) > scoreParams(0));
		assert.ok(scoreParams(100) > scoreParams(10));
		assert.ok(scoreParams(1000) <= 1);
	});

	it('scores context on a log scale', () => {
		assert.ok(scoreContext(128_000) > scoreContext(8_000));
		assert.ok(scoreContext(1_000_000) > scoreContext(128_000));
	});

	it('scores free quota tiers', () => {
		assert.equal(scoreFreeQuota('unlimited'), 1);
		assert.ok(scoreFreeQuota('monthly') < scoreFreeQuota('unlimited'));
		assert.ok(scoreFreeQuota('trial') < scoreFreeQuota('monthly'));
		assert.ok(scoreFreeQuota('none') < scoreFreeQuota('trial'));
	});

	it('composite is the product of all dimensions', () => {
		const s = scoreModelQuality({
			paramsB: 100,
			contextWindow: 128_000,
			freeQuota: 'unlimited',
			stabilityScore: 1,
		});
		assert.ok(s.composite > 0 && s.composite <= 1);
		assert.equal(s.recommendedWeight, Math.max(1, Math.round(s.composite * 100)));
	});

	it('zero stability drags composite to zero', () => {
		const s = scoreModelQuality({
			paramsB: 100,
			contextWindow: 128_000,
			freeQuota: 'unlimited',
			stabilityScore: 0,
		});
		assert.equal(s.composite, 0);
		assert.equal(s.recommendedWeight, 1);
	});

	it('defaults stability to 1 (cold start no penalty)', () => {
		const s = scoreModelQuality({
			paramsB: 100,
			contextWindow: 128_000,
			freeQuota: 'unlimited',
		});
		assert.equal(s.stabilityScore, 1);
	});
});
