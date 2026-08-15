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
      listModelsWithActiveRoutes: async (protocol?: string) => {
        // 模拟按协议过滤：仅返回 vendor 与请求协议一致的模型
        if (protocol) {
          return models.filter((m) => m.vendor === protocol);
        }
        return models;
      },
    },
  } as unknown as GatewayRepositories;
}

afterEach(() => {
  clearAutoModelCache();
});

describe('auto-model-selector — protocol filtering', () => {
  it('passes protocol to listModelsWithActiveRoutes so auto only considers matching-protocol models', async () => {
    let receivedProtocol: string | undefined;
    const repos = {
      modelRouting: {
        listModelsWithActiveRoutes: async (protocol?: string) => {
          receivedProtocol = protocol;
          return [makeModel('gpt-4o', 'openai', 128000)];
        },
      },
    } as unknown as GatewayRepositories;

    const candidates = await selectAutoModelCandidates(repos, undefined, 5, 'openai');
    assert.equal(receivedProtocol, 'openai');
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.id, 'gpt-4o');
  });

  it('selects best model among protocol-filtered candidates (context_window desc)', async () => {
    const repos = makeRepos([
      makeModel('gemini-2.5-flash', 'google', 1000000),
      makeModel('gpt-4o', 'openai', 128000),
      makeModel('claude-3-5-sonnet', 'anthropic', 200000),
    ]);

    // openai 协议下只应返回 gpt-4o（模拟过滤后）
    const openaiCandidates = await selectAutoModelCandidates(repos, undefined, 5, 'openai');
    assert.deepEqual(
      openaiCandidates.map((m) => m.id),
      ['gpt-4o']
    );

    // 不传协议时返回全部并按 context_window 降序
    const allCandidates = await selectAutoModelCandidates(repos, undefined, 5);
    assert.deepEqual(
      allCandidates.map((m) => m.id),
      ['gemini-2.5-flash', 'claude-3-5-sonnet', 'gpt-4o']
    );
  });

  it('selectAutoModel honors protocol filter', async () => {
    const repos = makeRepos([
      makeModel('gemini-2.5-flash', 'google', 1000000),
      makeModel('gpt-4o', 'openai', 128000),
    ]);

    const selected = await selectAutoModel(repos, undefined, 'openai');
    assert.ok(selected);
    assert.equal(selected.modelId, 'gpt-4o');
  });
});
