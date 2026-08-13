/**
 * 模型厂商 `vendor`：**权威 key 列表**见 `model-vendors.json`（下拉、归一化、展示名）。
 * 管理端静态价目：仅有自研模型的 catalog key 才有 `model-presets/<key>.json`（见 `model-preset.ts`）；聚合/托管类 key 仅用于下拉与归一化。
 */
import modelVendorsJson from './model-vendors.json';

export type ModelVendorCatalogEntry = {
	key: string;
	label: string;
	/** 中文展示名；缺失时回退 label。 */
	label_zh?: string;
};

const rawCatalog = modelVendorsJson as ModelVendorCatalogEntry[];

/** 按 JSON 顺序的稳定选项列表（用于下拉框）。 */
export const MODEL_VENDOR_OPTIONS: readonly ModelVendorCatalogEntry[] = rawCatalog;

const canonicalByLower = new Map<string, string>();
for (const { key } of MODEL_VENDOR_OPTIONS) {
	canonicalByLower.set(key.toLowerCase(), key);
}

const labelByCanonical = new Map<string, string>();
for (const { key, label } of MODEL_VENDOR_OPTIONS) {
	labelByCanonical.set(key, label);
}

/**
 * 写入/分组用：空 → `other`；仅当 `lower(trim)` 命中 catalog 的 key 时返回规范小写 key；否则 `other`。
 * 历史 PascalCase 数据已一次性对齐为 catalog key。
 */
export function normalizeModelVendorInput(v: unknown): string {
	const s = typeof v === 'string' ? v.trim() : '';
	if (!s) return 'other';
	return canonicalByLower.get(s.toLowerCase()) ?? 'other';
}

/** 展示用：catalog 命中用 label；否则归为 Other（与 normalize 一致）。 */
export function getModelVendorLabel(
	vendorKey: string | null | undefined,
	locale?: string
): string {
	const s = typeof vendorKey === 'string' ? vendorKey.trim() : '';
	const canon = s ? (canonicalByLower.get(s.toLowerCase()) ?? 'other') : 'other';
	const entry = rawCatalog.find((e) => e.key === canon);
	if (!entry) return labelByCanonical.get('other') ?? 'Other';
	if (locale === 'zh' && entry.label_zh) return entry.label_zh;
	return entry.label;
}
