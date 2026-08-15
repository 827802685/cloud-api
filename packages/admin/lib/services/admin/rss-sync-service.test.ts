import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	normalizeRssProviderModelName,
	parseRssXml,
	resolveRssModelKind,
	resolveRssModelKindFromCategories,
	resolveRssModalities,
	resolveRssUpstreamProtocol,
} from './rss-sync-service';

describe('parseRssXml: 中文分类标签', () => {
	const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>agnes/agnes-video-v2.0</title>
    <guid isPermaLink="false">agnes:agnes-video-v2.0</guid>
    <category>对话</category>
    <category>视频生成</category>
    <description>厂商: agnes | Base URL: https://api.agnes.ai/v1 | 分类: 对话, 视频生成 | 免费类型: unlimited | 额度: free | 限速: rate_limited | 上下文: 未知 | 能力: chat | 检测于: 2026-08-15T05:01:44.799Z</description>
  </item>
  <item>
    <title>google/gemini-3.7-flash</title>
    <guid isPermaLink="false">google:gemini-3.7-flash</guid>
    <category>对话</category>
    <category>视觉理解</category>
    <description>厂商: google | Base URL: https://generativelanguage.googleapis.com/v1beta | 分类: 对话, 视觉理解 | 免费类型: unlimited | 额度: free_with_rate_limit | 限速: 15 req/min | 上下文: 8,192 | 能力: chat | 检测于: 2026-08-15T05:01:44.799Z</description>
  </item>
</channel></rss>`;

	it('解析出多个中文分类标签', () => {
		const entries = parseRssXml(xml);
		assert.equal(entries.length, 2);
		const video = entries.find((e) => e.id === 'agnes/agnes-video-v2.0')!;
		assert.deepEqual(video.categories, ['对话', '视频生成']);
		const gemini = entries.find((e) => e.id === 'google/gemini-3.7-flash')!;
		assert.deepEqual(gemini.categories, ['对话', '视觉理解']);
	});
});

describe('resolveRssModelKindFromCategories: 中文分类映射', () => {
	it('向量嵌入 → embedding', () => {
		assert.equal(resolveRssModelKindFromCategories(['向量嵌入'], 'nemotron-3-embed-1b'), 'embedding');
	});

	it('图像生成 → image', () => {
		assert.equal(resolveRssModelKindFromCategories(['对话', '图像生成'], 'agnes-image-2.1-flash'), 'image');
	});

	it('视频生成 → video', () => {
		assert.equal(resolveRssModelKindFromCategories(['对话', '视频生成'], 'agnes-video-v2.0'), 'video');
	});

	it('语音/音频 结合模型名细分：tts → audio-tts', () => {
		assert.equal(
			resolveRssModelKindFromCategories(['对话', '语音/音频'], 'gemini-3.1-flash-tts-preview'),
			'audio-tts'
		);
	});

	it('语音/音频 结合模型名细分：omni 多模态 → vision', () => {
		assert.equal(
			resolveRssModelKindFromCategories(['对话', '语音/音频'], 'nemotron-3-nano-omni-30b'),
			'vision'
		);
	});

	it('视觉理解 → vision', () => {
		assert.equal(resolveRssModelKindFromCategories(['对话', '视觉理解'], 'gemini-3.7-flash'), 'vision');
	});

	it('对话/代码/推理 → chat', () => {
		assert.equal(resolveRssModelKindFromCategories(['对话'], 'glm-5.2'), 'chat');
		assert.equal(resolveRssModelKindFromCategories(['对话', '代码'], 'qwen3-coder'), 'chat');
		assert.equal(resolveRssModelKindFromCategories(['对话', '推理'], 'qwen3-thinking'), 'chat');
	});

	it('无匹配返回 null', () => {
		assert.equal(resolveRssModelKindFromCategories([], 'gpt-4o'), null);
	});
});

describe('resolveRssModelKind: 中文分类优先于能力标签/模型名', () => {
	it('分类含视频生成时，即使能力为 chat 也归为 video', () => {
		assert.equal(
			resolveRssModelKind(['chat'], 'agnes-video-v2.0', ['对话', '视频生成']),
			'video'
		);
	});

	it('分类含图像生成时归为 image', () => {
		assert.equal(
			resolveRssModelKind(['chat'], 'gemini-3.1-flash-image', ['对话', '视觉理解', '图像生成']),
			'image'
		);
	});

	it('分类含视觉理解时归为 vision', () => {
		assert.equal(
			resolveRssModelKind(['chat'], 'gemini-3.7-flash', ['对话', '视觉理解']),
			'vision'
		);
	});

	it('无分类时回退到能力标签/模型名推断', () => {
		assert.equal(resolveRssModelKind(['chat'], 'agnes-video-v2.0'), 'video');
		assert.equal(resolveRssModelKind(['chat'], 'gemini-3.7-flash'), 'chat');
	});
});

describe('resolveRssModalities: 分类标签参与模态推断', () => {
	it('vision 模型分类含语音/音频时追加 audio 输入', () => {
		const m = resolveRssModalities('vision', ['chat'], ['对话', '视觉理解', '语音/音频']);
		assert.deepEqual(m.input, ['text', 'image', 'audio']);
		assert.deepEqual(m.output, ['text']);
	});

	it('vision 模型分类含视频生成时追加 video 输入', () => {
		const m = resolveRssModalities('vision', ['chat'], ['对话', '视觉理解', '视频生成']);
		assert.deepEqual(m.input, ['text', 'image', 'video']);
	});
});

describe('resolveRssUpstreamProtocol: Google 多模态模型走 Gemini 协议', () => {
	const geminiEndpoints = { gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/models' } };

	it('Google vision 模型优先 Gemini 原生协议', () => {
		assert.equal(resolveRssUpstreamProtocol('google', 'vision', geminiEndpoints), 'gemini');
	});

	it('Google chat 模型优先 Gemini 原生协议', () => {
		assert.equal(resolveRssUpstreamProtocol('google', 'chat', geminiEndpoints), 'gemini');
	});

	it('Google 文生图模型必须走 OpenAI 协议', () => {
		assert.equal(resolveRssUpstreamProtocol('google', 'image', geminiEndpoints), 'openai');
	});

	it('Google 未配置 gemini 端点时回退 OpenAI', () => {
		assert.equal(resolveRssUpstreamProtocol('google', 'vision', null), 'openai');
	});
});

describe('normalizeRssProviderModelName: NVIDIA 冗余前缀折叠', () => {
	it('折叠双重前缀 nvidia/nvidia-* → nvidia/*', () => {
		assert.equal(
			normalizeRssProviderModelName('nvidia', 'nvidia/nvidia-nemotron-nano-9b-v2'),
			'nvidia/nemotron-nano-9b-v2'
		);
	});

	it('循环折叠三重前缀 nvidia/nvidia/nvidia/* → nvidia/*', () => {
		assert.equal(
			normalizeRssProviderModelName('nvidia', 'nvidia/nvidia/nvidia/nemotron-3-embed-1b'),
			'nvidia/nemotron-3-embed-1b'
		);
	});

	it('单段前缀保持不变', () => {
		assert.equal(
			normalizeRssProviderModelName('nvidia', 'nvidia/nemotron-nano-9b-v2'),
			'nvidia/nemotron-nano-9b-v2'
		);
	});

	it('非 NVIDIA 厂商原样返回', () => {
		assert.equal(
			normalizeRssProviderModelName('openrouter', 'openai/gpt-oss-20b'),
			'openai/gpt-oss-20b'
		);
	});
});
