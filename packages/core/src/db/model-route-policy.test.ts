import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	DEFAULT_ROUTE_STRATEGY,
	isRouteStrategyName,
	normalizeModelRoutePolicyInput,
	parseModelRoutePolicy,
	resolveModelRoutePolicyStrategy,
	routePolicyRuleKey,
} from './model-route-policy';

describe('routePolicyRuleKey / isRouteStrategyName', () => {
	it('builds protocol and capability keys', () => {
		assert.equal(routePolicyRuleKey('OpenAI', null, 'Default'), 'openai:default');
		assert.equal(routePolicyRuleKey('openai', 'Chat', 'free'), 'openai.chat:free');
	});

	it('recognizes strategy names', () => {
		assert.equal(isRouteStrategyName('affinity'), true);
		assert.equal(isRouteStrategyName(DEFAULT_ROUTE_STRATEGY), true);
		assert.equal(isRouteStrategyName('sticky'), false);
	});
});

describe('parseModelRoutePolicy', () => {
	it('returns null for empty / invalid / empty-content configs', () => {
		assert.equal(parseModelRoutePolicy(null), null);
		assert.equal(parseModelRoutePolicy(''), null);
		assert.equal(parseModelRoutePolicy('not json'), null);
		assert.equal(parseModelRoutePolicy('{"rules":{}}'), null);
		assert.equal(parseModelRoutePolicy('{"strategy":"nope"}'), null);
	});

	it('parses top-level strategy and rules', () => {
		const config = parseModelRoutePolicy(
			JSON.stringify({
				strategy: 'affinity',
				rules: {
					'openai:default': { strategy: 'weighted_random' },
					'openai.chat:default': { strategy: 'strict' },
				},
			})
		);
		assert.ok(config);
		assert.equal(config!.strategy, 'affinity');
		assert.equal(config!.rules.get('openai:default')?.strategy, 'weighted_random');
		assert.equal(config!.rules.get('openai.chat:default')?.strategy, 'strict');
	});

	it('accepts camelCase Gemini capabilities case-insensitively', () => {
		const config = parseModelRoutePolicy(
			JSON.stringify({
				rules: {
					'gemini.generateContent:default': { strategy: 'strict' },
					'gemini.streamGenerateContent:default': { strategy: 'weighted_random' },
				},
			})
		);
		assert.ok(config);
		assert.equal(config!.rules.get('gemini.generatecontent:default')?.strategy, 'strict');
		assert.equal(
			config!.rules.get('gemini.streamgeneratecontent:default')?.strategy,
			'weighted_random'
		);
		assert.equal(
			resolveModelRoutePolicyStrategy(
				JSON.stringify({
					rules: {
						'gemini.generateContent:default': { strategy: 'strict' },
					},
				}),
				'gemini',
				'generateContent',
				'default'
			),
			'strict'
		);
	});

	it('skips illegal strategy and illegal capability keys', () => {
		const config = parseModelRoutePolicy(
			JSON.stringify({
				strategy: 'round_robin',
				rules: {
					'openai:default': { strategy: 'bad' },
					'openai.messages:default': { strategy: 'strict' },
					'openai.chat:default': { strategy: 'strict' },
				},
			})
		);
		assert.ok(config);
		assert.equal(config!.strategy, 'round_robin');
		assert.equal(config!.rules.has('openai:default'), false);
		assert.equal(config!.rules.has('openai.messages:default'), false);
		assert.equal(config!.rules.get('openai.chat:default')?.strategy, 'strict');
	});
});

describe('resolveModelRoutePolicyStrategy', () => {
	const raw = JSON.stringify({
		strategy: 'affinity',
		rules: {
			'openai:default': { strategy: 'weighted_random' },
			'openai.chat:default': { strategy: 'strict' },
		},
	});

	it('lets capability rule beat protocol wildcard', () => {
		assert.equal(resolveModelRoutePolicyStrategy(raw, 'openai', 'chat', 'default'), 'strict');
	});

	it('falls back to protocol×group then top-level', () => {
		assert.equal(
			resolveModelRoutePolicyStrategy(raw, 'openai', 'images.generations', 'default'),
			'weighted_random'
		);
		assert.equal(resolveModelRoutePolicyStrategy(raw, 'anthropic', 'messages', 'default'), 'affinity');
	});

	it('returns null when nothing configured', () => {
		assert.equal(resolveModelRoutePolicyStrategy(null, 'openai', 'chat', 'default'), null);
		assert.equal(resolveModelRoutePolicyStrategy('{}', 'openai', 'chat', 'default'), null);
	});
});

describe('normalizeModelRoutePolicyInput', () => {
	it('returns null for empty input', () => {
		assert.equal(normalizeModelRoutePolicyInput(null), null);
		assert.equal(normalizeModelRoutePolicyInput('  '), null);
	});

	it('normalizes keys and strategies', () => {
		const out = normalizeModelRoutePolicyInput(
			JSON.stringify({
				strategy: 'Affinity',
				rules: {
					'OpenAI.Chat:Default': { strategy: 'Strict', junk: 1 },
				},
			})
		);
		assert.deepEqual(JSON.parse(out!), {
			strategy: 'affinity',
			rules: { 'openai.chat:default': { strategy: 'strict' } },
		});
	});

	it('throws for illegal strategy / capability / empty content', () => {
		assert.throws(() => normalizeModelRoutePolicyInput('nope'), /valid JSON/);
		assert.throws(
			() => normalizeModelRoutePolicyInput('{"strategy":"sticky"}'),
			/strategy must be one of/
		);
		assert.throws(
			() =>
				normalizeModelRoutePolicyInput(
					JSON.stringify({ rules: { 'openai.messages:default': { strategy: 'strict' } } })
				),
			/capability/
		);
		assert.throws(() => normalizeModelRoutePolicyInput('{"rules":{}}'), /at least one rule/);
	});
});
