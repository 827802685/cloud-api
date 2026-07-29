import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GatewayModel, GatewayProvider } from '@/lib/types';
import {
	requestOperationsForModel,
	upstreamOperationsForProviderModel,
} from './route-utils';

function model(overrides: Partial<GatewayModel> = {}): GatewayModel {
	return {
		id: 'model-1',
		display_name: 'Model 1',
		vendor: 'other',
		context_window: 128_000,
		max_tokens: 4096,
		tags: '[]',
		description: null,
		metadata: null,
		created_at: '',
		...overrides,
	};
}

function provider(endpoints: object): GatewayProvider {
	return {
		id: 'provider-1',
		name: 'Provider 1',
		endpoints: JSON.stringify(endpoints),
		description: null,
		created_at: '',
	};
}

describe('route form capability filters', () => {
	it('limits public operations by model modality', () => {
		assert.deepEqual(requestOperationsForModel(model(), 'openai'), ['chat', 'responses']);
		assert.deepEqual(
			requestOperationsForModel(
				model({ input_modalities: '["text","image"]', output_modalities: '["image"]' }),
				'openai'
			),
			['images.generations', 'images.edits']
		);
		assert.deepEqual(
			requestOperationsForModel(
				model({
					input_modalities: '["audio"]',
					output_modalities: '["text"]',
					pricing_profile: JSON.stringify({
						audio_billing_mode: 'per_second',
						audio: { price_per_second: 0.0001, minimum_seconds: 1 },
					}),
				}),
				'openai'
			),
			['audio.transcriptions']
		);
	});

	it('intersects provider endpoint capabilities with the model modality', () => {
		const baseProvider = provider({ openai: { base: 'https://example.com/v1' } });
		assert.deepEqual(upstreamOperationsForProviderModel(baseProvider, model(), 'openai'), [
			'chat',
		]);
		assert.deepEqual(
			upstreamOperationsForProviderModel(
				baseProvider,
				model({ input_modalities: '["text","image"]', output_modalities: '["image"]' }),
				'openai'
			),
			['images.generations', 'images.edits']
		);

		const endpointOnlyProvider = provider({
			openai: {
				endpoints: {
					'images.edits': 'https://example.com/v1/images/edits',
				},
			},
		});
		assert.deepEqual(
			upstreamOperationsForProviderModel(
				endpointOnlyProvider,
				model({ input_modalities: '["text","image"]', output_modalities: '["image"]' }),
				'openai'
			),
			['images.edits']
		);
	});
});
