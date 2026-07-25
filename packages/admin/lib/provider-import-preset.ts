/**
 * 管理端内置 **上游 Provider** 静态模板：用于一键导入 `providers` 行（预填 `endpoints`）。
 *
 * 权威列表见 [provider-import-presets.json](./provider-import-presets.json)。`vendor_key` 应对齐
 * [model-vendors.json](./model-vendors.json) 中的 `key`（展示名用 `getModelVendorLabel`）。
 *
 * Endpoint 约定（与 `listConfiguredCapabilities` / Admin 卡片展示一致）：
 * - **全能力 OpenAI 上游**（含 Images）：写 `openai.base`
 * - **仅 LLM / Chat Completions**：写 `openai.endpoints.chat`（完整 URL），**不要**写 `base`
 * - Anthropic / Gemini：协议本身无 Images 分支时可用 `base`（Anthropic 仅 messages；Gemini 为 generate/stream）
 *
 * 导入后不含 API Key，须在 Edit Provider 中手动添加。
 */
import rawPresets from './provider-import-presets.json';
import { getModelVendorLabel, normalizeModelVendorInput } from './model-vendor';
import type { AdminProviderImportCatalogItem } from '@/lib/services/admin/types';
import {
	listConfiguredCapabilities,
	parseProviderEndpoints,
	serializeProviderEndpoints,
	type ProviderEndpointCapability,
	type ProviderEndpointsMap,
	type ProviderEndpointsSource,
} from '@octafuse/core/provider-endpoints';

export type StaticProviderImportPresetRow = {
	name: string;
	vendor_key: string;
	/**
	 * Provider 产品级图标。省略时回退 `vendor_key`。
	 * 例如 Xiaomi MiMo 使用 `xiaomimimo`，而不是 Xiaomi 企业 Logo。
	 * 仅用于静态目录与动态展示，不写入 providers 表。
	 */
	icon_key?: string;
	endpoints: ProviderEndpointsMap;
	/** 可选；JSON 中可省略，导入后写入 providers.description 时为 null */
	description?: string | null;
	/**
	 * 仅用于公开 Catalog / 文档展示，不写入 providers 表。
	 * `description` 继续承载导入后的运维说明；此处提供本地化的用户侧摘要与官方入口。
	 */
	catalog?: {
		i18n: {
			zh: { name: string; description: string };
			en: { name: string; description: string };
		};
		links?: {
			/** Provider 官方平台、控制台或本地产品下载页。 */
			platform?: string;
			/** 可确认稳定时填写的 API Key 管理直达页。 */
			api_keys?: string;
		};
	};
};

/** 运行时 catalog 行键（JSON 数组下标字符串）；与入库 provider id 无关。 */
export type StaticProviderImportPresetWithKey = StaticProviderImportPresetRow & {
	catalog_key: string;
};

/** Import 弹窗 / catalog 摘要用的 OpenAI 端点一行展示。 */
export type ProviderImportOpenAiSummary = {
	/** 复制/展示用的主 URL（base 或 chat） */
	url: string;
	/** 是否配置了 openai.base（全能力） */
	hasBase: boolean;
	capabilities: ProviderEndpointCapability[];
};

const STATIC_ROWS = rawPresets as StaticProviderImportPresetRow[];

function providerEndpointSignature(endpoints: ProviderEndpointsSource['endpoints']): string {
	try {
		return serializeProviderEndpoints(parseProviderEndpoints({ endpoints })) ?? '';
	} catch {
		return '';
	}
}

const STATIC_VENDOR_BY_NAME = new Map(
	STATIC_ROWS.map((row) => [row.name.trim().toLowerCase(), normalizeModelVendorInput(row.vendor_key)])
);
const STATIC_VENDOR_BY_ENDPOINTS = new Map(
	STATIC_ROWS.map((row) => [providerEndpointSignature(row.endpoints), normalizeModelVendorInput(row.vendor_key)]).filter(
		(entry): entry is [string, string] => Boolean(entry[0])
	)
);
const STATIC_ICON_BY_NAME = new Map(
	STATIC_ROWS.map((row) => [row.name.trim().toLowerCase(), row.icon_key?.trim() || normalizeModelVendorInput(row.vendor_key)])
);
const STATIC_ICON_BY_ENDPOINTS = new Map(
	STATIC_ROWS.map((row) => [
		providerEndpointSignature(row.endpoints),
		row.icon_key?.trim() || normalizeModelVendorInput(row.vendor_key),
	]).filter((entry): entry is [string, string] => Boolean(entry[0]))
);

function normalizedImportedProviderName(name: string | null | undefined): string {
	return String(name ?? '')
		.trim()
		.replace(/\s+\(\d+\)$/, '')
		.toLowerCase();
}

/**
 * 不落库推导 Provider Vendor：优先匹配 Import 模板名（兼容重复导入的 `(2)` 后缀），
 * 名称被修改时再按规范化 Endpoint 签名匹配；自定义且无法识别时回退 `other`。
 */
export function inferStaticProviderVendorKey(provider: {
	name?: string | null;
	endpoints?: ProviderEndpointsSource['endpoints'];
}): string {
	const normalizedName = normalizedImportedProviderName(provider.name);
	const byName = STATIC_VENDOR_BY_NAME.get(normalizedName);
	if (byName) return byName;

	const signature = providerEndpointSignature(provider.endpoints);
	return (signature && STATIC_VENDOR_BY_ENDPOINTS.get(signature)) || 'other';
}

/**
 * 不落库推导 Provider 产品图标：匹配规则与 Vendor 相同，但允许模板声明产品级
 * `icon_key`。无法识别的自定义 Provider 回退其 Vendor，再回退 `other`。
 */
export function inferStaticProviderIconKey(provider: {
	name?: string | null;
	endpoints?: ProviderEndpointsSource['endpoints'];
	vendor_key?: string | null;
}): string {
	const normalizedName = normalizedImportedProviderName(provider.name);
	const byName = STATIC_ICON_BY_NAME.get(normalizedName);
	if (byName) return byName;

	const signature = providerEndpointSignature(provider.endpoints);
	const byEndpoints = signature && STATIC_ICON_BY_ENDPOINTS.get(signature);
	if (byEndpoints) return byEndpoints;

	return normalizeModelVendorInput(provider.vendor_key);
}

function protocolsForPreset(p: StaticProviderImportPresetRow): AdminProviderImportCatalogItem['protocols'] {
	const map = parseProviderEndpoints({ endpoints: p.endpoints });
	const out: AdminProviderImportCatalogItem['protocols'] = [];
	if (map.openai) out.push('openai');
	if (map.anthropic) out.push('anthropic');
	if (map.gemini) out.push('gemini');
	return out;
}

/** 从已解析的 endpoints map 取 OpenAI 协议展示摘要（base 或 chat-only）。 */
export function summarizeOpenAiImportEndpoints(
	map: ProviderEndpointsMap
): ProviderImportOpenAiSummary | null {
	const cfg = map.openai;
	if (!cfg) return null;
	const url =
		cfg.base ||
		cfg.endpoints?.chat ||
		Object.values(cfg.endpoints ?? {})[0] ||
		'';
	if (!url) return null;
	return {
		url,
		hasBase: Boolean(cfg.base),
		capabilities: listConfiguredCapabilities(map, 'openai'),
	};
}

/** 全部静态模板行（含 catalog 键与 endpoints）。 */
export function listStaticProviderImportPresets(): StaticProviderImportPresetWithKey[] {
	return STATIC_ROWS.filter((r) => String(r.name ?? '').trim().length > 0).map((row, index) => ({
		...row,
		catalog_key: String(index),
	}));
}

/** 供 `GET /admin/providers/import/catalog`：摘要不含密钥。 */
export function listStaticProviderImportCatalogForAdmin(): AdminProviderImportCatalogItem[] {
	return listStaticProviderImportPresets().map((p) => {
		const vendorCanon = normalizeModelVendorInput(p.vendor_key);
		const map = parseProviderEndpoints({ endpoints: p.endpoints });
		return {
			id: p.catalog_key,
			name: String(p.name ?? '').trim(),
			vendor_key: vendorCanon,
			icon_key: p.icon_key?.trim() || vendorCanon,
			vendor_label: getModelVendorLabel(vendorCanon),
			protocols: protocolsForPreset(p),
			endpoints: serializeProviderEndpoints(map),
			description: p.description != null && String(p.description).trim() ? String(p.description).trim() : null,
		};
	});
}
