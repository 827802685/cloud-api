import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	effectiveUpstreamOperation,
	isRequestOperationForProtocol,
	normalizeRouteOperation,
} from './route-topology';

describe('route topology operations', () => {
	it('validates operations within their public protocol', () => {
		assert.equal(isRequestOperationForProtocol('openai', 'chat'), true);
		assert.equal(isRequestOperationForProtocol('openai', 'responses'), true);
		assert.equal(isRequestOperationForProtocol('anthropic', 'messages'), true);
		assert.equal(isRequestOperationForProtocol('gemini', 'streamGenerateContent'), true);
		assert.equal(isRequestOperationForProtocol('anthropic', 'chat'), false);
	});

	it('keeps wildcard compatibility for migrated routes', () => {
		assert.equal(normalizeRouteOperation(undefined), '*');
		assert.equal(isRequestOperationForProtocol('openai', '*'), true);
		assert.equal(effectiveUpstreamOperation('*', 'images.generations'), 'images.generations');
		assert.equal(effectiveUpstreamOperation('chat', 'responses'), 'chat');
	});
});
