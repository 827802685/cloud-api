import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import {
  selectAutoModelCandidates,
  selectAutoModel,
  clearAutoModelCache,
} from './auto-model-selector';
import type { GatewayRepositories, ModelRow } from '@cloud-api/core';

function makeModel(id: string, vendor: string, contextWindow: number | null): ModelRow {
  return {
    id,
    display_name: id,
    vendor,
    context_window: contextWindow,
    max_tokens: 8192,
    pricing_profile: null,
    tags: '[]',
    route_groups: '["default"]',
    description: null,
    metadata: null,
    input_modalities: '[]',
    output_modalities: '[]',
    released_at: null,
    created_at: '2024-01-01',
  };
}

function makeRepos(models: ModelRow[]): GatewayRepositories {
  return {
    modelRouting: {
      listModelsWithActiveRoutes: async () => models,
    },
  } as unknown as GatewayRepositories;
}

afterEach(() => {
  clearAutoModelCache();
});

describe('auto-model-selector — selects from all models (no protocol filtering)', () => {
  it('lists all models with active routes (no protocol filter passed)', async () => {
    let receivedProtocol: string | undefined = 'sentinel';
    const repos = {
      modelRouting: {
        listModelsWithActiveRoutes: async (protocol?: string) => {
          receivedProtocol = protocol;
          return [makeModel('gpt-4o', 'openai', 128000)];
        },
      },
    } as unknown as GatewayRepositories;

    const candidates = await selectAutoModelCandidates(repos, undefined, 5);
    assert.equal(receivedProtocol, undefined, 'auto must not filter by protocol');
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.id, 'gpt-4o');
  });

  it('selects best model among all candidates (context_window desc), including google models', async () => {
    const repos = makeRepos([
      makeModel('gemini-2.5-flash', 'google', 1000000),
      makeModel('gpt-4o', 'openai', 128000),
      makeModel('claude-3-5-sonnet', 'anthropic', 200000),
    ]);

    const candidates = await selectAutoModelCandidates(repos, undefined, 5);
    assert.deepEqual(
      candidates.map((m) => m.id),
      ['gemini-2.5-flash', 'claude-3-5-sonnet', 'gpt-4o']
    );
  });

  it('selectAutoModel picks the largest-context model regardless of protocol', async () => {
    const repos = makeRepos([
      makeModel('gemini-2.5-flash', 'google', 1000000),
      makeModel('gpt-4o', 'openai', 128000),
    ]);

    const selected = await selectAutoModel(repos);
    assert.ok(selected);
    assert.equal(selected.modelId, 'gemini-2.5-flash');
  });

  it('honors preferred vendor when specified', async () => {
    const repos = makeRepos([
      makeModel('gemini-2.5-flash', 'google', 1000000),
      makeModel('gpt-4o', 'openai', 128000),
    ]);

    const selected = await selectAutoModel(repos, 'openai');
    assert.ok(selected);
    assert.equal(selected.modelId, 'gpt-4o');
  });
});
