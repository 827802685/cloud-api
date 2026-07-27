import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	parseAudioDurationFromUpstreamBody,
	resolveUpstreamAudioResponseFormat,
} from './openai-audio-driver';

describe('resolveUpstreamAudioResponseFormat', () => {
	it('forces verbose_json for whisper-1', () => {
		assert.equal(resolveUpstreamAudioResponseFormat('whisper-1', 'json'), 'verbose_json');
		assert.equal(resolveUpstreamAudioResponseFormat('whisper-1', 'text'), 'verbose_json');
	});

	it('uses json/text for gpt-4o-transcribe family', () => {
		assert.equal(resolveUpstreamAudioResponseFormat('gpt-4o-transcribe', 'json'), 'json');
		assert.equal(resolveUpstreamAudioResponseFormat('gpt-4o-mini-transcribe', 'text'), 'text');
		assert.equal(
			resolveUpstreamAudioResponseFormat('gpt-4o-mini-transcribe-2025-12-15', 'verbose_json'),
			'json'
		);
	});

	it('allows diarized_json for diarize model', () => {
		assert.equal(
			resolveUpstreamAudioResponseFormat('gpt-4o-transcribe-diarize', 'diarized_json'),
			'diarized_json'
		);
		assert.equal(
			resolveUpstreamAudioResponseFormat('gpt-4o-transcribe-diarize', 'verbose_json'),
			'json'
		);
	});
});

describe('parseAudioDurationFromUpstreamBody', () => {
	it('reads verbose_json duration', () => {
		assert.equal(parseAudioDurationFromUpstreamBody({ text: 'hi', duration: 12.5 }), 12.5);
	});

	it('reads usage.seconds from gpt-4o json', () => {
		assert.equal(
			parseAudioDurationFromUpstreamBody({
				text: 'hi',
				usage: { type: 'duration', seconds: 3.25 },
			}),
			3.25
		);
	});

	it('reads max segment end from diarized_json', () => {
		assert.equal(
			parseAudioDurationFromUpstreamBody({
				segments: [
					{ speaker: 'A', start: 0, end: 1.2, text: 'a' },
					{ speaker: 'B', start: 1.2, end: 4.0, text: 'b' },
				],
			}),
			4.0
		);
	});
});
