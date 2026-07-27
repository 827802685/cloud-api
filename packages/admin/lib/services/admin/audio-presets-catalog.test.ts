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

describe('static audio model presets (*-audio.json)', () => {
	it('every audio preset uses per_second pricing', () => {
		const audioRows = listStaticModelPresets().filter((r) => {
			const usd = asPricing(r.pricing.usd);
			return usd.audio_billing_mode === 'per_second' && usd.audio != null;
		});
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

	it('locks OpenAI transcription catalog unit prices (duration catalog; CNY ×7)', () => {
		const byId = new Map(listStaticModelPresets().map((r) => [r.id, r]));

		const whisper = byId.get('whisper-1')!;
		assert.equal(asPricing(whisper.pricing.usd).audio?.price_per_second, 0.0001);
		assert.equal(asPricing(whisper.pricing.cny).audio?.price_per_second, 0.0007);

		const mini = byId.get('gpt-4o-mini-transcribe')!;
		assert.equal(asPricing(mini.pricing.usd).audio?.price_per_second, 0.00005);
		assert.equal(asPricing(mini.pricing.cny).audio?.price_per_second, 0.00035);

		const full = byId.get('gpt-4o-transcribe')!;
		assert.equal(asPricing(full.pricing.usd).audio?.price_per_second, 0.0001);

		const diarize = byId.get('gpt-4o-transcribe-diarize')!;
		assert.equal(asPricing(diarize.pricing.usd).audio?.price_per_second, 0.0001);
	});
});
