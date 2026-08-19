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
  existingRoutes: { upstream_protocol: string; status: string; disabled_at?: string | null; route_group?: string }[];
  autoCreateCalls?: { modelId: string; providerId: string; modelName: string; protocol: string }[];
  providerDisabled?: boolean;
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
      getProviderById: async () =>
        opts.providerDisabled ? { ...makeProvider(), status: 'disabled' } : makeProvider(),
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
      existingRoutes: [{ upstream_protocol: 'openai', status: 'disabled', disabled_at: null }],
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

  it('auto-creates when matching-protocol route is circuit-disabled (disabled_at set)', async () => {
    const calls: { modelId: string; providerId: string; modelName: string; protocol: string }[] = [];
    const repos = makeRepos({
      activeRows: [],
      existingRoutes: [
        { upstream_protocol: 'openai', status: 'disabled', disabled_at: '2026-08-15T00:00:00Z' },
      ],
      autoCreateCalls: calls,
    });

    await resolveRoutesForSurface(repos, {
      modelId: 'model-1',
      routeGroup: 'default',
      requestProtocol: 'openai',
      requestOperation: 'chat',
    });

    assert.equal(calls.length, 1, 'circuit-disabled route should not block auto-create');
  });

  it('auto-creates when matching-protocol route points to a disabled provider', async () => {
    const calls: { modelId: string; providerId: string; modelName: string; protocol: string }[] = [];
    const repos = makeRepos({
      // active openai route exists, but its provider is disabled → routeRowToResult returns null
      activeRows: [makeRouteRow({ upstream_protocol: 'openai' })],
      existingRoutes: [{ upstream_protocol: 'openai', status: 'active' }],
      providerDisabled: true,
      autoCreateCalls: calls,
    });

    await resolveRoutesForSurface(repos, {
      modelId: 'model-1',
      routeGroup: 'default',
      requestProtocol: 'openai',
      requestOperation: 'chat',
    });

    assert.equal(calls.length, 1, 'dead-provider route should not block auto-create');
  });

  it('auto-creates when matching-protocol route exists only in another route group', async () => {
    const calls: { modelId: string; providerId: string; modelName: string; protocol: string }[] = [];
    const repos = makeRepos({
      activeRows: [],
      existingRoutes: [
        { upstream_protocol: 'openai', status: 'active', route_group: 'premium' },
      ],
      autoCreateCalls: calls,
    });

    await resolveRoutesForSurface(repos, {
      modelId: 'model-1',
      routeGroup: 'default',
      requestProtocol: 'openai',
      requestOperation: 'chat',
    });

    assert.equal(calls.length, 1, 'route in another group should not block auto-create for default');
  });

  it('strips vendor/ prefix from provider_model_name when auto-creating route', async () => {
    const calls: { modelId: string; providerId: string; modelName: string; protocol: string }[] = [];
    const repos = makeRepos({
      activeRows: [],
      existingRoutes: [],
      autoCreateCalls: calls,
    });

    await resolveRoutesForSurface(repos, {
      modelId: 'google/gemini-3.1-flash-lite-preview',
      routeGroup: 'default',
      requestProtocol: 'openai',
      requestOperation: 'chat',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].modelName, 'gemini-3.1-flash-lite-preview');
  });
});

describe('normalizeProviderModelName — defensive prefix stripping', () => {
  it('strips vendor/ prefix when provider_model_name was copied verbatim from model_id', async () => {
    const repos = makeRepos({
      activeRows: [
        makeRouteRow({
          model_id: 'google/gemini-3.5-flash',
          provider_model_name: 'google/gemini-3.5-flash',
          upstream_protocol: 'openai',
        }),
      ],
      existingRoutes: [],
    });

    const { routes } = await resolveRoutesForSurface(repos, {
      modelId: 'google/gemini-3.5-flash',
      routeGroup: 'default',
      requestProtocol: 'openai',
      requestOperation: 'chat',
    });

    assert.equal(routes.length, 1);
    assert.equal(routes[0].providerModelName, 'gemini-3.5-flash');
  });

  it('does not strip already-correct provider_model_name (nvidia double-prefix model_id)', async () => {
    const repos = makeRepos({
      activeRows: [
        makeRouteRow({
          model_id: 'nvidia/nvidia/llama-3.1-nemotron-70b-instruct',
          provider_model_name: 'nvidia/llama-3.1-nemotron-70b-instruct',
          upstream_protocol: 'openai',
        }),
      ],
      existingRoutes: [],
    });

    const { routes } = await resolveRoutesForSurface(repos, {
      modelId: 'nvidia/nvidia/llama-3.1-nemotron-70b-instruct',
      routeGroup: 'default',
      requestProtocol: 'openai',
      requestOperation: 'chat',
    });

    assert.equal(routes.length, 1);
    assert.equal(routes[0].providerModelName, 'nvidia/llama-3.1-nemotron-70b-instruct');
  });

  it('does not strip OpenRouter provider_model_name that differs from model_id', async () => {
    const repos = makeRepos({
      activeRows: [
        makeRouteRow({
          model_id: 'openrouter/google/gemma-4-26b-a4b-it',
          provider_model_name: 'google/gemma-4-26b-a4b-it:free',
          upstream_protocol: 'openai',
        }),
      ],
      existingRoutes: [],
    });

    const { routes } = await resolveRoutesForSurface(repos, {
      modelId: 'openrouter/google/gemma-4-26b-a4b-it',
      routeGroup: 'default',
      requestProtocol: 'openai',
      requestOperation: 'chat',
    });

    assert.equal(routes.length, 1);
    assert.equal(routes[0].providerModelName, 'google/gemma-4-26b-a4b-it:free');
  });
});
