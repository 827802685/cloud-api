import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { dispatchOpenAiRoute } from './openai-driver';
import type { RouteResult } from '../model-router';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeRoute(openaiBase: string): RouteResult {
  return {
    targetId: 'route-1',
    modelSurfaceId: null,
    routePoolId: null,
    providerId: 'provider-1',
    providerName: 'google',
    providerModelName: 'gemini-2.0-flash',
    upstreamProtocol: 'openai',
    upstreamOperation: 'chat',
    adapter: 'passthrough',
    providerEndpoints: {
      openai: { base: openaiBase },
    },
    providerApiKey: 'test-key',
    priceOverrideRaw: null,
    routeMeteredProfileJson: null,
    routeChargedProfileJson: null,
    customParams: null,
    routeGroup: 'default',
    routePriority: 0,
    routeWeight: 1,
  };
}

describe('dispatchOpenAiRoute — Google OpenAI-compatible endpoint param stripping', () => {
  it('strips frequency_penalty / presence_penalty / logit_bias / metadata / store for generativelanguage.googleapis.com', async () => {
    let sentBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: 'chatcmpl-1', choices: [], usage: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const route = makeRoute('https://generativelanguage.googleapis.com/v1beta/openai');
    await dispatchOpenAiRoute(route, {
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'hi' }],
      frequency_penalty: 0.5,
      presence_penalty: 0.5,
      logit_bias: { 123: 1 },
      metadata: { foo: 'bar' },
      store: true,
      temperature: 0.7,
    });

    assert.ok(sentBody, 'fetch should have been called');
    assert.equal(sentBody.frequency_penalty, undefined);
    assert.equal(sentBody.presence_penalty, undefined);
    assert.equal(sentBody.logit_bias, undefined);
    assert.equal(sentBody.metadata, undefined);
    assert.equal(sentBody.store, undefined);
    assert.equal(sentBody.temperature, 0.7);
    assert.equal(sentBody.model, 'gemini-2.0-flash');
  });

  it('keeps frequency_penalty for non-Google OpenAI-compatible endpoints', async () => {
    let sentBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: 'chatcmpl-2', choices: [], usage: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const route = makeRoute('https://api.openai.com/v1');
    await dispatchOpenAiRoute(route, {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      frequency_penalty: 0.5,
    });

    assert.ok(sentBody, 'fetch should have been called');
    assert.equal(sentBody.frequency_penalty, 0.5);
  });
});
