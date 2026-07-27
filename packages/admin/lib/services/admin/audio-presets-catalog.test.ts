import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ParsedPricingProfile } from '@octafuse/core/db/pricing-profile';
import { listStaticModelPresets } from '@/lib/model-preset';
import { listStaticModelPresetCatalogForAdmin } from './models-service';

/** OpenAI Audio Transcriptions 当前官方别名（不含日期快照、不含 Realtime-only）。 */
const EXPECTED_AUDIO_IDS = [
	'gpt-4o-mini-transcribe',
	'gpt-4o-transcribe',
	'gpt-4o-transcribe-diarize',
	'whisper-1',
].sort();

type PresetPricingJson = Partial<ParsedPricingProfile> & {
	tiers?: ParsedPricingProfile['tiers'];
};

const asPricing = (raw: unknown): PresetPricingJson => raw as PresetPricingJson;

function isAudioPresetPricing(usd: PresetPricingJson): boolean {
	if (usd.audio_billing_mode === 'per_second' && usd.audio != null) return true;
	if (usd.audio_billing_mode === 'token' && Array.isArray(usd.tiers) && usd.tiers.length > 0) {
		return true;
	}
	return false;
}

describe('static audio model presets (*-audio.json)', () => {
	it('every audio preset uses per_second or token pricing', () => {
		const audioRows = listStaticModelPresets().filter((r) =>
			isAudioPresetPricing(asPricing(r.pricing.usd))
		);
		assert.deepEqual(
			audioRows.map((r) => r.id).sort(),
			EXPECTED_AUDIO_IDS
		);
		for (const row of audioRows) {
			assert.ok(row.vendor, `vendor required for ${row.id}`);
			assert.equal((row.modalities?.input ?? []).includes('audio'), true);
		}
	});

	it('Admin import catalog marks audio kind for the same ids', () => {
		const audioCatalog = listStaticModelPresetCatalogForAdmin().filter((r) => r.kind === 'audio');
		assert.deepEqual(
			audioCatalog.map((r) => r.id).sort(),
			EXPECTED_AUDIO_IDS
		);
	});

	it('locks OpenAI transcription catalog unit prices (whisper per_second; 4o token; CNY ×7)', () => {
		const byId = new Map(listStaticModelPresets().map((r) => [r.id, r]));

		const whisper = byId.get('whisper-1')!;
		assert.equal(asPricing(whisper.pricing.usd).audio_billing_mode, 'per_second');
		assert.equal(asPricing(whisper.pricing.usd).audio?.price_per_second, 0.0001);
		assert.equal(asPricing(whisper.pricing.cny).audio?.price_per_second, 0.0007);

		const mini = byId.get('gpt-4o-mini-transcribe')!;
		assert.equal(asPricing(mini.pricing.usd).audio_billing_mode, 'token');
		assert.equal(asPricing(mini.pricing.usd).tiers?.[0]?.input_price, 1.25);
		assert.equal(asPricing(mini.pricing.usd).tiers?.[0]?.output_price, 5);
		assert.equal(asPricing(mini.pricing.cny).tiers?.[0]?.input_price, 8.75);
		assert.equal(asPricing(mini.pricing.cny).tiers?.[0]?.output_price, 35);

		const full = byId.get('gpt-4o-transcribe')!;
		assert.equal(asPricing(full.pricing.usd).audio_billing_mode, 'token');
		assert.equal(asPricing(full.pricing.usd).tiers?.[0]?.input_price, 2.5);
		assert.equal(asPricing(full.pricing.usd).tiers?.[0]?.output_price, 10);
		assert.equal(asPricing(full.pricing.cny).tiers?.[0]?.input_price, 17.5);
		assert.equal(asPricing(full.pricing.cny).tiers?.[0]?.output_price, 70);

		const diarize = byId.get('gpt-4o-transcribe-diarize')!;
		assert.equal(asPricing(diarize.pricing.usd).audio_billing_mode, 'token');
		assert.equal(asPricing(diarize.pricing.usd).tiers?.[0]?.input_price, 2.5);
		assert.equal(asPricing(diarize.pricing.usd).tiers?.[0]?.output_price, 10);
	});
});
