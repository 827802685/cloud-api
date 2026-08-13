/**
 * 响应净化：过滤上游透传的内部元数据字段（如 Google 的 `extra_content.thought_signature`）。
 *
 * 背景：部分中转/聚合供应商会把上游原始响应里的内部字段原样透传，例如
 * `extra_content: { "google": { "thought_signature": "..." } }`。
 * 这些字段对客户端对话无意义，属于「垃圾数据」，标准 API 中转服务应只返回干净的 `content`。
 *
 * 本模块提供递归删除已知内部字段的工具，供各 egress driver 在转发前调用：
 * - 非流式 JSON：`sanitizeJsonResponseText`
 * - 流式 SSE 单行：`sanitizeSseDataLine`
 */

/** 已知内部/元数据字段名（大小写不敏感），递归删除。 */
const INTERNAL_FIELD_NAMES = new Set([
	'extra_content', // Google thought_signature 等内部签名
	'safety_attributes', // Google 安全属性
	'generation_metadata', // Google 生成元数据
	'prompt_feedback', // Google 提示反馈
	'model_version', // Google 模型版本
	'thought_signature', // 独立出现的思维链签名
	'grounding_metadata', // Google grounding 元数据（客户端一般用不到）
]);

export function isInternalFieldName(name: string): boolean {
	return INTERNAL_FIELD_NAMES.has(name.toLowerCase());
}

/**
 * 递归删除对象/数组中的内部字段。
 * 若未删除任何字段则返回**原引用**（便于调用方判断是否发生变更），否则返回新对象（不修改入参）。
 * 非对象/数组原样返回。
 */
export function stripInternalFields(value: unknown): unknown {
	if (Array.isArray(value)) {
		let changed = false;
		const out = value.map((item) => {
			const s = stripInternalFields(item);
			if (s !== item) changed = true;
			return s;
		});
		return changed ? out : value;
	}
	if (value !== null && typeof value === 'object') {
		let changed = false;
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			if (isInternalFieldName(k)) {
				changed = true;
				continue;
			}
			const s = stripInternalFields(v);
			if (s !== v) changed = true;
			out[k] = s;
		}
		return changed ? out : value;
	}
	return value;
}

/** 净化非流式 JSON 响应文本；解析失败时原样返回。 */
export function sanitizeJsonResponseText(text: string): string {
	try {
		const parsed = JSON.parse(text);
		return JSON.stringify(stripInternalFields(parsed));
	} catch {
		return text;
	}
}

/**
 * 净化单行 SSE `data: {...}`；非 `data:` 行、`[DONE]`、解析失败原样返回。
 * 仅在确实存在内部字段时才重新序列化，避免无谓开销。
 */
export function sanitizeSseDataLine(line: string): string {
	if (!line.startsWith('data: ')) return line;
	const data = line.slice(6).trim();
	if (data === '[DONE]') return line;
	try {
		const parsed = JSON.parse(data);
		if (parsed === null || typeof parsed !== 'object') return line;
		const stripped = stripInternalFields(parsed);
		if (stripped === parsed) return line;
		return 'data: ' + JSON.stringify(stripped);
	} catch {
		return line;
	}
}
