import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveRoutesForSurface } from './model-router';
import type { GatewayRepositories } from '@cloud-api/core';
import type { ModelRouteRow } from '@cloud-api/core';

function makeRouteRow(overrides: Partial<ModelRouteRow>): ModelRouteRow {
  return {
    id: 'route-1',
    model_id: 'model-1',
    provider_id: 'provider-1',
    provider_model_name: 'gemini-2.0-flash',
    priority: 0,
    status: 'active',
    route_group: 'default',
    weight: 1,
    price_override: null,
    custom_params: null,
    upstream_protocol: 'gemini',
    route_pool_id: null,
    upstream_operation: 'chat',
    adapter: 'passthrough',
    ...overrides,
  };
}

function makeProvider() {
  return {
    id: 'provider-1',
    name: 'google',
    endpoints: JSON.stringify({ openai: { base: 'https://generativelanguage.googleapis.com/v1beta/openai' } }),
    api_key: 'test-key',
    status: 'active',
    description: null,
    created_at: '2024-01-01',
  };
}

function makeModel() {
  return {
    id: 'model-1',
    display_name: 'Gemini Flash',
    vendor: 'google',
    context_window: 1000000,
    max_tokens: 8192,
    pricing_profile: null,
    tags: '[]',
    description: null,
    metadata: null,
    input_modalities: '[]',
    output_modalities: '[]',
    released_at: null,
    created_at: '2024-01-01',
  };
}

function makeRepos(opts: {
  activeRows: ModelRouteRow[];
  existingRoutes: { upstream_protocol: string; status: string }[];
  autoCreateCalls?: { modelId: string; providerId: string; modelName: string; protocol: string }[];
}): GatewayRepositories {
  const calls = opts.autoCreateCalls ?? [];
  return {
    modelRouting: {
      recoverExpiredDisabledRoutes: async () => {},
      resolveModelSurface: async () => null,
      getModelRoutesByModelId: async () => opts.activeRows,
      getModelById: async () => makeModel(),
      findProviderByVendor: async () => 'provider-1',
      autoCreateRoute: async (modelId: string, providerId: string, modelName: string, protocol: string) => {
        calls.push({ modelId, providerId, modelName, protocol });
        return 'route-new';
      },
    },
    providers: {
      getProviderById: async () => makeProvider(),
    },
    routes: {
      listModelRoutesWithJoins: async () => opts.existingRoutes as never,
    },
  } as unknown as GatewayRepositories;
}

describe('resolveRoutesForSurface — auto-route creation', () => {
  it('auto-creates an openai route when model only has gemini routes (auto mode)', async () => {
    const calls: { modelId: string; providerId: string; modelName: string; protocol: string }[] = [];
    const repos = makeRepos({
      // active rows returned by getModelRoutesByModelId: only gemini → no openai route after filter
      activeRows: [makeRouteRow({ upstream_protocol: 'gemini' })],
      // existing routes (listModelRoutesWithJoins): only gemini protocol
      existingRoutes: [{ upstream_protocol: 'gemini', status: 'active' }],
      autoCreateCalls: calls,
    });

    const result = await resolveRoutesForSurface(repos, {
      modelId: 'model-1',
      routeGroup: 'default',
      requestProtocol: 'openai',
      requestOperation: 'chat',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].protocol, 'openai');
    assert.equal(calls[0].modelName, 'model-1');
    assert.equal(result.routes.length, 0, 'new route not active in same call');
  });

  it('auto-creates when model has no routes at all', async () => {
    const calls: { modelId: string; providerId: string; modelName: string; protocol: string }[] = [];
    const repos = makeRepos({
      activeRows: [],
      existingRoutes: [],
      autoCreateCalls: calls,
    });

    await resolveRoutesForSurface(repos, {
      modelId: 'model-1',
      routeGroup: 'default',
      requestProtocol: 'openai',
      requestOperation: 'chat',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].protocol, 'openai');
  });

  it('skips auto-create when model has matching-protocol routes but all disabled (respect manual disable)', async () => {
    const calls: { modelId: string; providerId: string; modelName: string; protocol: string }[] = [];
    const repos = makeRepos({
      activeRows: [],
      existingRoutes: [{ upstream_protocol: 'openai', status: 'disabled' }],
      autoCreateCalls: calls,
    });

    await resolveRoutesForSurface(repos, {
      modelId: 'model-1',
      routeGroup: 'default',
      requestProtocol: 'openai',
      requestOperation: 'chat',
    });

    assert.equal(calls.length, 0, 'should respect manual disable of matching-protocol routes');
  });
});
