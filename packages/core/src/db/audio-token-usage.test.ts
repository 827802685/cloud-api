import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildAudioTokenPrecheckUsage,
	computeAudioTokenMeteredCost,
	parseOpenAiAudioTokenUsage,
} from './audio-token-usage';
import type { BillingPriceSnapshot } from './pricing-profile';

const MINI_PRICES: BillingPriceSnapshot = {
	input_price: 1.25,
	output_price: 5,
	cache_read_price: null,
	cache_write_price: null,
	image_input_price: null,
	image_input_cache_price: null,
	image_output_price: null,
};

describe('parseOpenAiAudioTokenUsage', () => {
	it('parses type=tokens with input_token_details', () => {
		const usage = parseOpenAiAudioTokenUsage({
			text: 'hello',
			usage: {
				type: 'tokens',
				input_tokens: 120,
				output_tokens: 15,
				total_tokens: 135,
				input_token_details: {
					audio_tokens: 100,
					text_tokens: 20,
				},
			},
		});
		assert.ok(usage);
		assert.equal(usage!.input_tokens, 120);
		assert.equal(usage!.output_tokens, 15);
		assert.equal(usage!.audio_tokens, 100);
		assert.equal(usage!.text_tokens, 20);
		assert.equal(usage!.total_tokens, 135);
	});

	it('returns null for type=duration (whisper)', () => {
		assert.equal(
			parseOpenAiAudioTokenUsage({
				usage: { type: 'duration', seconds: 2.5 },
			}),
			null
		);
	});

	it('returns null without usage', () => {
		assert.equal(parseOpenAiAudioTokenUsage({ text: 'x' }), null);
	});
});

describe('computeAudioTokenMeteredCost', () => {
	it('meters input+output at $/1M', () => {
		const cost = computeAudioTokenMeteredCost(
			{
				input_tokens: 1_000_000,
				output_tokens: 1_000_000,
				total_tokens: 2_000_000,
				audio_tokens: 1_000_000,
				text_tokens: 0,
				raw_usage: null,
			},
			MINI_PRICES
		);
		assert.equal(cost, 1.25 + 5);
	});
});

describe('buildAudioTokenPrecheckUsage', () => {
	it('scales with duration and stays above floors', () => {
		const u = buildAudioTokenPrecheckUsage(2);
		assert.ok(u.input_tokens >= 10);
		assert.ok(u.output_tokens >= 64);
		assert.equal(u.total_tokens, u.input_tokens + u.output_tokens);
	});
});
