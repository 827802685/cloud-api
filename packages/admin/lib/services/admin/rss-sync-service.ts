/**
 * RSS 免费模型同步：从 ModelRadar RSS 拉取免费模型列表，自动：
 * 1. 解析 RSS item（厂商、Base URL、上下文、能力、免费额度）
 * 2. 按厂商匹配/自动创建 provider（api_key 留空，导入后由用户填写）
 * 3. 导入模型到 `models` 表（去重，已存在则跳过）
 * 4. 自动创建 route（weight 用四维评分推荐值）
 *
 * 触发方式：手动（后台按钮）+ 定时（Cloudflare Cron，每 15 天）。
 */
import type { GatewayRepositories } from '@cloud-api/core';
import { scoreModelQuality, type FreeQuotaTier } from '@cloud-api/proxy';
import { createModelService } from './models-service';
import { createModelRouteService } from './model-routes-service';

/** 默认 RSS 源 */
export const DEFAULT_RSS_URL = 'https://rss.zjkl.dpdns.org/rss.xml';

/** 默认同步间隔（毫秒）：15 天 */
export const RSS_SYNC_INTERVAL_MS = 15 * 24 * 60 * 60 * 1000;

/** system_config 中记录上次同步时间的 key */
export const RSS_LAST_SYNC_KEY = 'rss_last_sync_at';

/** 解析后的 RSS 模型条目 */
export type RssModelEntry = {
	/** 平台模型 id（如 `openrouter/openai/gpt-oss-20b:free`） */
	id: string;
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

/** RSS 模型能力分类：文生图 / 音频转写 / 视频 / 文本聊天。 */
export type RssModelKind = 'chat' | 'image' | 'audio' | 'video';

/** 根据能力标签推断模型种类。优先级：image > audio > video > chat。 */
export function resolveRssModelKind(capabilities: string[]): RssModelKind {
	const caps = new Set(capabilities.map((c) => c.trim().toLowerCase()));
	if (caps.has('image')) return 'image';
	if (caps.has('audio')) return 'audio';
	if (caps.has('video')) return 'video';
	return 'chat';
}

/** 按能力生成 input/output modalities（vision 追加 image 输入）。 */
export function resolveRssModalities(
	kind: RssModelKind,
	capabilities: string[]
): { input: string[]; output: string[] } {
	const caps = new Set(capabilities.map((c) => c.trim().toLowerCase()));
	switch (kind) {
		case 'image':
			return { input: ['text'], output: ['image'] };
		case 'audio':
			return { input: ['audio'], output: ['text'] };
		case 'video':
			// 网关暂不支持 video 输出，按文本聊天模型导入
			return { input: ['text'], output: ['text'] };
		case 'chat':
		default:
			return {
				input: caps.has('vision') ? ['text', 'image'] : ['text'],
				output: ['text'],
			};
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
		case 'audio':
			return {
				audio_billing_mode: 'per_second',
				audio: { price_per_second: 0, minimum_seconds: 1 },
			};
		case 'video':
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
		case 'audio':
			return 'audio.transcriptions';
		case 'video':
		case 'chat':
		default:
			return 'chat';
	}
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
			id: title,
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
async function findProviderWithKey(
	repos: GatewayRepositories,
	entry: RssModelEntry
): Promise<string | null> {
	return repos.modelRouting.findProviderByVendor(entry.vendor);
}

/**
 * 执行一次 RSS 免费模型同步。
 * @param repos 网关仓储
 * @param url RSS 源地址
 */
export async function syncFreeModelsFromRss(
	repos: GatewayRepositories,
	url: string = DEFAULT_RSS_URL
): Promise<RssSyncResult> {
	const entries = await fetchAndParseRss(url);
	const result: RssSyncResult = {
		source: url,
		parsed: entries.length,
		models_created: 0,
		models_skipped: 0,
		models_no_provider: 0,
		routes_created: 0,
		routes_skipped: 0,
		failed: [],
	};

	// 按 vendor 缓存已匹配的 provider，避免重复查询
	const providerCache = new Map<string, string | null>();
	// 本次同步内已处理过的模型 id，避免同一 id 在 feed 中重复出现时重复创建
	const seenModelIds = new Set<string>();

	for (const entry of entries) {
		try {
			// 0. 本次同步内去重：同一 id 只处理一次
			if (seenModelIds.has(entry.id)) {
				result.models_skipped++;
				result.routes_skipped++;
				continue;
			}
			seenModelIds.add(entry.id);

			// 能力 → 模型种类 / modalities / pricing / operation
			const kind = resolveRssModelKind(entry.capabilities);
			const modalities = resolveRssModalities(kind, entry.capabilities);
			const pricingProfile = resolveRssPricingProfile(kind);
			const operation = resolveRssRouteOperation(kind);

			// 1. provider：仅匹配平台上带 key 的已有 provider
			let providerId = providerCache.get(entry.vendor);
			if (providerId === undefined) {
				providerId = await findProviderWithKey(repos, entry);
				providerCache.set(entry.vendor, providerId);
			}
			if (!providerId) {
				// 该厂商 key 未配置到平台，跳过（不建模型/路由）
				result.models_no_provider++;
				continue;
			}

			// 2. 模型（去重：同 id 已存在则跳过）
			const existingModel = await repos.models.getModelDetailWithRouteCounts(entry.id);
			if (!existingModel) {
				await createModelService(repos, {
					id: entry.id,
					display_name: entry.id,
					vendor: entry.vendor,
					context_window: entry.contextWindow,
					// 文生图/音频转写模型不适用 LLM 默认 max_tokens
					max_tokens: kind === 'chat' || kind === 'video' ? 8192 : null,
					pricing_profile: pricingProfile,
					tags: ['Free'],
					input_modalities: modalities.input,
					output_modalities: modalities.output,
					description: `Free model via RSS sync (${entry.vendor}).`,
				});
				result.models_created++;
			} else {
				result.models_skipped++;
			}

			// 3. 路由（去重：同 model + provider 已存在则跳过）
			const existingRoutes = await repos.modelRouting.getModelRoutesByModelId(entry.id);
			const routeExists = existingRoutes.some((r) => r.provider_id === providerId);
			if (routeExists) {
				result.routes_skipped++;
				continue;
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
				provider_model_name: entry.providerModelName,
				upstream_protocol: 'openai',
				request_protocol: 'openai',
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
	}

	// 无论成功失败都记录本次同步时间，避免每次访问都重复触发
	await recordRssSyncTime(repos);

	return result;
}
