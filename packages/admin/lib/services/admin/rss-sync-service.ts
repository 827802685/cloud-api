/**
 * RSS 免费模型同步：从 ModelRadar RSS 拉取免费模型列表，自动：
 * 1. 解析 RSS item（厂商、Base URL、上下文、能力、免费额度）
 * 2. 按厂商匹配/自动创建 provider（api_key 留空，导入后由用户填写）
 * 3. 导入模型到 `models` 表（去重，已存在则跳过）
 * 4. 自动创建 route（weight 用四维评分推荐值）
 *
 * 触发方式：手动（后台按钮）+ 定时（Cloudflare Cron，每 15 天）。
 */
import type { GatewayRepositories, UpstreamProtocol } from '@cloud-api/core';
import { parseProviderEndpoints, type ProviderEndpointsMap } from '@cloud-api/core/provider-endpoints';
import { scoreModelQuality, type FreeQuotaTier } from '@cloud-api/proxy';
import { createModelService } from './models-service';
import { createModelRouteService } from './model-routes-service';
import type { WorkersAiClassifier } from './workers-ai-classifier';

/** 默认 RSS 源 */
export const DEFAULT_RSS_URL = 'https://rss.zjkl.dpdns.org/rss.xml';

/** 默认同步间隔（毫秒）：15 天 */
export const RSS_SYNC_INTERVAL_MS = 15 * 24 * 60 * 60 * 1000;

/** system_config 中记录上次同步时间的 key */
export const RSS_LAST_SYNC_KEY = 'rss_last_sync_at';

/** 解析后的 RSS 模型条目 */
export type RssModelEntry = {
	/** 平台模型 id（RSS title 去掉 `:free` 后缀） */
	id: string;
	/** 原始 RSS title（含 `:free` 后缀等） */
	rawTitle: string;
	/** 厂商（如 `openrouter`、`nvidia`） */
	vendor: string;
	/** 上游模型名（如 `openai/gpt-oss-20b:free`） */
	providerModelName: string;
	/** 上游 Base URL（如 `https://openrouter.ai/api/v1`） */
	baseUrl: string | null;
	/** 上下文窗口（token 数）；未知为 null */
	contextWindow: number | null;
	/** 能力标签（chat、vision、audio...） */
	capabilities: string[];
	/** 免费额度档位 */
	freeQuota: FreeQuotaTier;
	/** 参数量（十亿），从模型名推断；未知为 null */
	paramsB: number | null;
};

/** 同步结果汇总 */
export type RssSyncResult = {
	source: string;
	parsed: number;
	models_created: number;
	models_skipped: number;
	models_no_provider: number;
	/** 网关不支持的模型种类（嵌入/TTS/视频等），跳过导入 */
	models_skipped_unsupported: number;
	/** 其中视频生成模型数量（网关暂不支持视频生成，单独统计便于用户识别） */
	models_skipped_video: number;
	routes_created: number;
	routes_skipped: number;
	failed: Array<{ id: string; message: string }>;
};

/** 从模型名推断参数量（十亿）。如 `20b`→20、`550b`→550、`a3b`→3、`1b`→1。 */
export function inferParamsB(modelName: string): number | null {
	const m = modelName.toLowerCase().match(/(\d+(?:\.\d+)?)b/);
	if (!m) return null;
	const v = Number(m[1]);
	return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * 去掉模型 ID 末尾的 `:free` 后缀（如 `openrouter/openai/gpt-oss-20b:free` → `openrouter/openai/gpt-oss-20b`）。
 * 平台 `models.id` 统一不带 `:free`，避免与静态目录导入的同一模型重复；`:free` 仅保留在上游模型名中。
 */
export function stripFreeSuffix(id: string): string {
	return id.replace(/:free$/i, '');
}

/**
 * RSS 模型能力分类：按实际功能细分，而非一刀切 LLM。
 * 注意：google / nvidia / modelscope 等厂商在 RSS 中「能力」恒为 chat，
 * 需结合模型名推断真实功能（文生图 / 嵌入 / TTS / 多模态等）。
 */
export type RssModelKind =
	| 'chat' // 文本 LLM
	| 'vision' // 多模态 LLM（图像/音频输入，文本输出）
	| 'image' // 文生图
	| 'audio-asr' // 语音转文字
	| 'audio-tts' // 文字转语音（网关暂不支持，跳过）
	| 'embedding' // 向量嵌入（网关暂不支持，跳过）
	| 'video' // 视频生成（网关暂不支持，跳过）
	| 'rerank' // 重排序（网关暂不支持，跳过）
	| 'special'; // 专用模型（内容安全/奖励/解析/评测等，走 chat API）

/** 模型名 → 种类 的模式表（能力标签不可靠时兜底）。按优先级从高到低匹配。 */
const RSS_KIND_NAME_PATTERNS: ReadonlyArray<{ kind: RssModelKind; patterns: readonly RegExp[] }> = [
	{
		kind: 'image',
		patterns: [
			/(^|[^a-z])image([^a-z]|$)/,
			/qwen-image|sdxl|stable-diffusion|dall-?e|flux|imagen|sana|kolors|cogview|seedream|wanx|pixart|midjourney|playground-v|firefly|aura-flow|wuerstchen|deepfloyd|sd3|hunyuan-image|taiyi/,
		],
	},
	{
		kind: 'audio-tts',
		patterns: [
			/(^|[^a-z])tts([^a-z]|$)/,
			/text-to-speech|texttospeech|(^|[^a-z])speech([^a-z]|$)|(^|[^a-z])voice([^a-z]|$)/,
		],
	},
	{
		kind: 'audio-asr',
		patterns: [
			/whisper|(^|[^a-z])asr([^a-z]|$)|transcrib|speech-to-text|(^|[^a-z])stt([^a-z]|$)|parakeet|canary|conformer/,
		],
	},
	{
		kind: 'embedding',
		patterns: [
			/embed|text-embedding|(^|[^a-z])bge([^a-z]|$)|(^|[^a-z])gte([^a-z]|$)|(^|[^a-z])e5([^a-z]|$)|mxbai|nomic-embed|jina-embeddings/,
		],
	},
	{
		kind: 'video',
		patterns: [
			/(^|[^a-z])video([^a-z]|$)/,
			/veo|sora|wan-|hunyuan-video|cogvideo|kling|pixverse|runway|mochi|ltx-video|gen-3|gen-2/,
		],
	},
	{
		kind: 'rerank',
		patterns: [/rerank/],
	},
	{
		kind: 'vision',
		patterns: [
			/(^|[^a-z])vl([^a-z]|$)/,
			/(^|[^a-z])vlm([^a-z]|$)/,
			/(^|[^a-z])vision([^a-z]|$)/,
			/(^|[^a-z])omni([^a-z]|$)/,
			/(^|[^a-z])mimo([^a-z]|$)/,
			/internvl|qwen3-vl|qwen2\.5?-vl|glm-[0-9.]+v([^a-z]|$)|ernie-[0-9.]+-vl|multimodal/,
		],
	},
	{
		kind: 'special',
		patterns: [
			/content-safety|safety-guard|(^|[^a-z])guard([^a-z]|$)|(^|[^a-z])reward([^a-z]|$)|(^|[^a-z])parse([^a-z]|$)|classifier|moderation|judg|critic|evaluator|(^|[^a-z])detect([^a-z]|$)/,
		],
	},
];

/** 仅凭模型名推断种类；无匹配返回 `chat`。 */
export function inferRssModelKindFromName(modelName: string): RssModelKind {
	const n = modelName.toLowerCase();
	for (const { kind, patterns } of RSS_KIND_NAME_PATTERNS) {
		for (const re of patterns) {
			if (re.test(n)) return kind;
		}
	}
	return 'chat';
}

/**
 * 根据能力标签 + 模型名推断模型种类。
 * 能力标签（openrouter/agnes/zhipu 等可靠厂商）优先；google/nvidia/modelscope 等厂商标签恒为 chat，
 * 此时用模型名兜底，避免把文生图 / 嵌入 / TTS / 多模态等误判为大语言模型。
 */
export function resolveRssModelKind(capabilities: string[], modelName: string): RssModelKind {
	const caps = new Set(capabilities.map((c) => c.trim().toLowerCase()));
	const fromName = inferRssModelKindFromName(modelName);
	if (caps.has('image')) return 'image';
	if (caps.has('video')) return 'video';
	if (caps.has('audio')) {
		// audio 标签可能是 ASR / TTS / 多模态输入，用模型名细分
		if (fromName === 'audio-asr' || fromName === 'audio-tts') return fromName;
		return 'vision';
	}
	// 能力标签明确为 vision（多模态 LLM）时直接采用，避免被模型名无特征误判为 chat
	if (caps.has('vision')) return 'vision';
	return fromName;
}

/** 网关能否直接服务该种类（否则跳过导入，避免建出无法请求的模型）。 */
export function isRssModelKindSupported(kind: RssModelKind): boolean {
	return (
		kind === 'chat' ||
		kind === 'vision' ||
		kind === 'image' ||
		kind === 'audio-asr' ||
		kind === 'special'
	);
}

/** 按能力生成 input/output modalities（vision 追加 image 输入，audio/video 标签追加对应输入）。 */
export function resolveRssModalities(
	kind: RssModelKind,
	capabilities: string[]
): { input: string[]; output: string[] } {
	const caps = new Set(capabilities.map((c) => c.trim().toLowerCase()));
	switch (kind) {
		case 'image':
			return { input: ['text'], output: ['image'] };
		case 'audio-asr':
			return { input: ['audio'], output: ['text'] };
		case 'vision': {
			const input = ['text', 'image'];
			if (caps.has('audio')) input.push('audio');
			if (caps.has('video')) input.push('video');
			return { input, output: ['text'] };
		}
		case 'audio-tts':
			return { input: ['text'], output: ['audio'] };
		case 'embedding':
			return { input: ['text'], output: ['text'] };
		case 'video':
		case 'rerank':
		case 'special':
		case 'chat':
		default:
			return { input: ['text'], output: ['text'] };
	}
}

/** 免费模型的零价 pricing_profile（按种类给出合法形状，供 isImageGenerationModel / isAudioTranscriptionModel 识别）。 */
export function resolveRssPricingProfile(kind: RssModelKind): Record<string, unknown> {
	switch (kind) {
		case 'image':
			return {
				image_billing_mode: 'token',
				tiers: [
					{
						upto: null,
						input_price: 0,
						output_price: 0,
						image_input_price: 0,
						image_output_price: 0,
					},
				],
			};
		case 'audio-asr':
			return {
				audio_billing_mode: 'per_second',
				audio: { price_per_second: 0, minimum_seconds: 1 },
			};
		case 'audio-tts':
		case 'embedding':
		case 'video':
		case 'rerank':
		case 'vision':
		case 'special':
		case 'chat':
		default:
			return {
				tiers: [
					{
						upto: null,
						input_price: 0,
						output_price: 0,
						cache_read_price: 0,
						cache_write_price: 0,
					},
				],
			};
	}
}

/** 路由 request/upstream operation（OpenAI 协议）。 */
export function resolveRssRouteOperation(kind: RssModelKind): string {
	switch (kind) {
		case 'image':
			return 'images.generations';
		case 'audio-asr':
			return 'audio.transcriptions';
		case 'audio-tts':
		case 'embedding':
		case 'video':
		case 'rerank':
		case 'vision':
		case 'special':
		case 'chat':
		default:
			return 'chat';
	}
}

/**
 * 结合 Workers AI 智能归类与启发式规则得到模型种类。
 * - 能力标签（image/video/audio）是强证据，直接信任启发式结果，不额外调用 AI（省时）。
 * - 启发式结果为默认 `chat`（厂商能力标签恒为 chat、模型名无特征）时，才调用 Workers AI 复核，
 *   避免把 google/nvidia 等厂商的文生图 / TTS / 嵌入 / 视频模型误判为大语言模型。
 * - Workers AI 未配置 / 调用失败 / 置信度不足时降级为启发式结果。
 */
export async function resolveRssModelKindWithAi(
	entry: RssModelEntry,
	aiClassifier: WorkersAiClassifier | null | undefined
): Promise<RssModelKind> {
	const heuristic = resolveRssModelKind(entry.capabilities, entry.providerModelName);
	if (!aiClassifier) return heuristic;

	const caps = new Set(entry.capabilities.map((c) => c.trim().toLowerCase()));
	// 能力标签明确时（image/video/audio）启发式已可靠，避免无谓的 AI 调用
	if (caps.has('image') || caps.has('video') || caps.has('audio')) return heuristic;
	// 启发式已给出非默认分类（如模型名含 image/tts/embed/vl 等特征）时同样信任启发式
	if (heuristic !== 'chat') return heuristic;

	try {
		const ai = await aiClassifier.classify({
			id: entry.id,
			displayName: entry.id,
			description: `vendor=${entry.vendor}; capabilities=${entry.capabilities.join(',') || 'none'}`,
			capabilities: entry.capabilities,
		});
		if (ai && ai.confidence >= 0.5) return ai.kind;
	} catch {
		// 降级为启发式
	}
	return heuristic;
}

/**
 * 为 RSS 模型选择最合适的上游协议：
 * - 文生图 / 音频转写必须走 OpenAI 协议（网关 Images/Audio API 仅用 OpenAI 路由）。
 * - Google 聊天模型：优先 Gemini 原生协议（provider 已配置 gemini 端点时），否则 OpenAI。
 * - 其余厂商默认 OpenAI。
 */
export function resolveRssUpstreamProtocol(
	vendor: string,
	kind: RssModelKind,
	providerEndpoints: ProviderEndpointsMap | null | undefined
): UpstreamProtocol {
	if (kind === 'image' || kind === 'audio-asr') return 'openai';
	if (vendor.toLowerCase() === 'google' && kind === 'chat' && providerEndpoints?.gemini?.base) {
		return 'gemini';
	}
	return 'openai';
}

/** 由上游协议派生对应的 operation（与 `resolveRssRouteOperation` 对齐）。 */
export function resolveRssOperationForProtocol(kind: RssModelKind, protocol: UpstreamProtocol): string {
	if (protocol === 'gemini') return 'models.generate';
	return resolveRssRouteOperation(kind);
}

/**
 * 规范化上游模型名：
 * - NVIDIA 的 RSS 模型名形如 `nvidia/nvidia-nemotron-*-v2` 或 `nvidia/nvidia/nemotron-*`，
 *   冗余了 `nvidia/` 段，NIM OpenAI 端点期望 `nvidia/nemotron-*-v2`，需折叠为单段 `nvidia/` 前缀，避免上游 404。
 * - 其余厂商原样返回。
 */
export function normalizeRssProviderModelName(vendor: string, providerModelName: string): string {
	if (vendor.toLowerCase() === 'nvidia') {
		const trimmed = providerModelName.trim();
		// `nvidia/nvidia-...` 或 `nvidia/nvidia/...` → `nvidia/...`（折叠冗余的 nvidia 段）
		if (/^nvidia\/nvidia(?:\/|-)/i.test(trimmed)) {
			return trimmed.replace(/^nvidia\/nvidia(?:\/|-)/i, 'nvidia/');
		}
	}
	return providerModelName;
}

/** 解析上下文数字（去掉千分位逗号）。 */
function parseContext(raw: string | null): number | null {
	if (!raw) return null;
	const cleaned = raw.replace(/[,\s]/g, '');
	const m = cleaned.match(/(\d+)/);
	if (!m) return null;
	const v = Number(m[1]);
	return Number.isFinite(v) && v > 0 ? v : null;
}

/** 解析 description 中的 `键: 值` 字段。 */
function parseDescriptionFields(description: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const part of description.split('|')) {
		const idx = part.indexOf(':');
		if (idx <= 0) continue;
		const key = part.slice(0, idx).trim();
		const value = part.slice(idx + 1).trim();
		if (key) out[key] = value;
	}
	return out;
}

/** 解析免费额度档位。 */
function parseFreeQuota(raw: string | null): FreeQuotaTier {
	if (!raw) return 'unlimited';
	const s = raw.toLowerCase();
	if (s.includes('unlimited')) return 'unlimited';
	if (s.includes('monthly')) return 'monthly';
	if (s.includes('trial') || s.includes('prototyping')) return 'trial';
	return 'unlimited';
}

/** 从 RSS XML 文本解析出模型条目列表。 */
export function parseRssXml(xml: string): RssModelEntry[] {
	const items: RssModelEntry[] = [];
	const itemRe = /<item>([\s\S]*?)<\/item>/g;
	let match: RegExpExecArray | null;
	while ((match = itemRe.exec(xml)) !== null) {
		const block = match[1]!;
		const title = extractTag(block, 'title');
		const guid = extractTag(block, 'guid');
		const description = extractTag(block, 'description');
		if (!title) continue;

		// 厂商：guid 前缀（`openrouter:...`）优先，其次 title 首段
		let vendor = '';
		if (guid && guid.includes(':')) {
			vendor = guid.slice(0, guid.indexOf(':')).trim();
		}
		if (!vendor && title.includes('/')) {
			vendor = title.slice(0, title.indexOf('/')).trim();
		}

		// 上游模型名：guid 冒号后部分，否则 title 去掉厂商前缀
		let providerModelName = title;
		if (guid && guid.includes(':')) {
			providerModelName = guid.slice(guid.indexOf(':') + 1).trim();
		} else if (vendor && title.startsWith(`${vendor}/`)) {
			providerModelName = title.slice(vendor.length + 1).trim();
		}

		const fields = parseDescriptionFields(description);
		const baseUrl = fields['Base URL']?.trim() || null;
		const contextWindow = parseContext(fields['上下文'] ?? fields['Context'] ?? null);
		const capsRaw = fields['能力'] ?? fields['Capabilities'] ?? '';
		const capabilities = capsRaw
			.split(',')
			.map((s) => s.trim())
			.filter((s) => s.length > 0 && s !== '未知');

		items.push({
			id: stripFreeSuffix(title),
			rawTitle: title,
			vendor: vendor || 'unknown',
			providerModelName: providerModelName || title,
			baseUrl,
			contextWindow,
			capabilities,
			freeQuota: parseFreeQuota(fields['免费类型'] ?? fields['FreeType'] ?? null),
			paramsB: inferParamsB(providerModelName),
		});
	}
	return items;
}

function extractTag(block: string, tag: string): string {
	const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
	const m = block.match(re);
	if (!m) return '';
	// 去除可能的 CDATA
	return m[1]!.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

/** 拉取并解析 RSS。 */
export async function fetchAndParseRss(url: string): Promise<RssModelEntry[]> {
	const res = await fetch(url, {
		headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' },
	});
	if (!res.ok) {
		throw new Error(`RSS fetch failed: HTTP ${res.status}`);
	}
	const xml = await res.text();
	return parseRssXml(xml);
}

/** 记录本次同步时间（system_config）。 */
export async function recordRssSyncTime(repos: GatewayRepositories, at: Date = new Date()): Promise<void> {
	await repos.systemConfig.upsertSystemConfigValue(RSS_LAST_SYNC_KEY, at.toISOString());
}

/** 查询上次同步时间与是否到期（距上次 > 15 天）。 */
export async function getRssSyncDue(repos: GatewayRepositories): Promise<{
	lastSyncAt: string | null;
	due: boolean;
}> {
	const raw = await repos.systemConfig.getConfig(RSS_LAST_SYNC_KEY);
	if (!raw) {
		return { lastSyncAt: null, due: true };
	}
	const last = new Date(raw).getTime();
	const due = Number.isFinite(last) && Date.now() - last >= RSS_SYNC_INTERVAL_MS;
	return { lastSyncAt: raw, due };
}

/**
 * 匹配平台上已有的 provider（仅限带 API key 且 active 的）。
 * 匹配不到返回 null —— 说明该厂商的 key 尚未配置到平台，跳过该模型。
 */
async function findProviderWithKey(repos: GatewayRepositories, vendor: string): Promise<string | null> {
	return repos.modelRouting.findProviderByVendor(vendor);
}

/**
 * 执行一次 RSS 免费模型同步。
 * @param repos 网关仓储
 * @param url RSS 源地址
 * @param aiClassifier 可选的 Workers AI 归类器（未配置时降级为启发式归类）
 */
export async function syncFreeModelsFromRss(
	repos: GatewayRepositories,
	url: string = DEFAULT_RSS_URL,
	aiClassifier?: WorkersAiClassifier | null
): Promise<RssSyncResult> {
	const entries = await fetchAndParseRss(url);
	const result: RssSyncResult = {
		source: url,
		parsed: entries.length,
		models_created: 0,
		models_skipped: 0,
		models_no_provider: 0,
		models_skipped_unsupported: 0,
		models_skipped_video: 0,
		routes_created: 0,
		routes_skipped: 0,
		failed: [],
	};

	// 按 vendor 缓存已匹配的 provider，避免重复查询
	const providerCache = new Map<string, string | null>();
	// providerId → 解析后的端点配置（用于协议选择）
	const providerEndpointsCache = new Map<string, ProviderEndpointsMap>();
	// 本次同步内已处理过的模型 id，避免同一 id 在 feed 中重复出现时重复创建
	const seenModelIds = new Set<string>();

	// 预填充 provider 缓存：一次性并行查询所有唯一厂商，避免逐条串行查询
	const uniqueVendors = [...new Set(entries.map((e) => e.vendor))];
	await Promise.all(
		uniqueVendors.map(async (vendor) => {
			if (providerCache.has(vendor)) return;
			providerCache.set(vendor, await findProviderWithKey(repos, vendor));
		})
	);

	// 单条处理逻辑（含去重、建模型、建路由）
	const processEntry = async (entry: RssModelEntry): Promise<void> => {
		try {
			// 0. 本次同步内去重：同一 id 只处理一次
			if (seenModelIds.has(entry.id)) {
				result.models_skipped++;
				result.routes_skipped++;
				return;
			}
			seenModelIds.add(entry.id);

			// 能力 → 模型种类（Workers AI 智能归类 + 启发式兜底）
			const kind = await resolveRssModelKindWithAi(entry, aiClassifier);
			// 网关不支持的种类（嵌入/TTS/视频/重排）直接跳过，避免建出无法请求的模型
			if (!isRssModelKindSupported(kind)) {
				result.models_skipped_unsupported++;
				if (kind === 'video') result.models_skipped_video++;
				return;
			}
			const modalities = resolveRssModalities(kind, entry.capabilities);
			const pricingProfile = resolveRssPricingProfile(kind);

			// 1. provider：仅匹配平台上带 key 的已有 provider
			const providerId = providerCache.get(entry.vendor) ?? null;
			if (!providerId) {
				// 该厂商 key 未配置到平台，跳过（不建模型/路由）
				result.models_no_provider++;
				return;
			}

			// 2. 上游协议：Google 聊天模型优先 Gemini 原生协议（provider 已配置 gemini 端点时）
			let providerEndpoints = providerEndpointsCache.get(providerId);
			if (!providerEndpoints) {
				const bases = await repos.providers.getProviderProtocolBases(providerId);
				providerEndpoints = parseProviderEndpoints({
					endpoints: bases?.endpoints ?? null,
				});
				providerEndpointsCache.set(providerId, providerEndpoints);
			}
			const upstreamProtocol = resolveRssUpstreamProtocol(entry.vendor, kind, providerEndpoints);
			const operation = resolveRssOperationForProtocol(kind, upstreamProtocol);
			// NVIDIA 上游模型名规范化（去掉冗余 `nvidia/` 前缀段）
			const providerModelName = normalizeRssProviderModelName(entry.vendor, entry.providerModelName);

			// 3. 模型（去重：同 id 已存在则跳过）
			const existingModel = await repos.models.getModelDetailWithRouteCounts(entry.id);
			if (!existingModel) {
				await createModelService(repos, {
					id: entry.id,
					display_name: entry.id,
					vendor: entry.vendor,
					context_window: entry.contextWindow,
					// 文生图/音频转写模型不适用 LLM 默认 max_tokens
					max_tokens: kind === 'chat' || kind === 'vision' || kind === 'special' ? 8192 : null,
					pricing_profile: pricingProfile,
					input_modalities: modalities.input,
					output_modalities: modalities.output,
					tags: kind === 'special' ? ['special-purpose'] : [],
					description: `Free model via RSS sync (${entry.vendor}).`,
				});
				result.models_created++;
			} else {
				result.models_skipped++;
			}

			// 4. 路由（去重：同 model + provider 已存在则跳过）
			const existingRoutes = await repos.modelRouting.getModelRoutesByModelId(entry.id);
			const routeExists = existingRoutes.some((r) => r.provider_id === providerId);
			if (routeExists) {
				result.routes_skipped++;
				return;
			}

			// weight 用四维评分推荐值
			const quality = scoreModelQuality({
				paramsB: entry.paramsB,
				contextWindow: entry.contextWindow,
				freeQuota: entry.freeQuota,
			});

			await createModelRouteService(repos, {
				model_id: entry.id,
				provider_id: providerId,
				provider_model_name: providerModelName,
				upstream_protocol: upstreamProtocol,
				request_protocol: upstreamProtocol,
				request_operation: operation,
				upstream_operation: operation,
				adapter: 'passthrough',
				weight: quality.recommendedWeight,
				status: 'active',
				route_group: 'default',
			});
			result.routes_created++;
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			result.failed.push({ id: entry.id, message });
		}
	};

	// 分批并行处理，控制并发避免压垮数据库
	const CONCURRENCY = 10;
	for (let i = 0; i < entries.length; i += CONCURRENCY) {
		const batch = entries.slice(i, i + CONCURRENCY);
		await Promise.all(batch.map((entry) => processEntry(entry)));
	}

	// 无论成功失败都记录本次同步时间，避免每次访问都重复触发
	await recordRssSyncTime(repos);

	return result;
}
