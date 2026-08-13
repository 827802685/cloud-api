/**
 * Playground：从上游原始报文（SSE / JSON / text）中提取 assistant 可读正文，
 * 并将推理类字段与正文分列，便于区分。
 */

export type PlaygroundProtocol = 'openai' | 'anthropic' | 'gemini';

export type PlaygroundResponseParseMode = 'sse' | 'json' | 'text';

/** 推理链 / thinking 与最终正文分列 */
export type MergedAssistantParts = {
	reasoning: string;
	body: string;
};

const emptyParts = (): MergedAssistantParts => ({ reasoning: '', body: '' });

/** 由响应 Content-Type 推断解析方式（与 Playground `send` 分支一致）。 */
export function inferPlaygroundParseMode(contentType: string | null | undefined): PlaygroundResponseParseMode | null {
	if (contentType == null || contentType === '') {
		return null;
	}
	const lower = contentType.toLowerCase();
	if (lower.includes('text/event-stream')) {
		return 'sse';
	}
	if (lower.includes('application/json') && !lower.includes('text/event-stream')) {
		return 'json';
	}
	return 'text';
}

function extractOpenAiMessageContent(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}
	if (!Array.isArray(content)) {
		return '';
	}
	let s = '';
	for (const part of content) {
		if (!part || typeof part !== 'object') {
			continue;
		}
		const p = part as { type?: unknown; text?: unknown };
		if (p.type === 'text' && typeof p.text === 'string') {
			s += p.text;
		}
	}
	return s;
}

/**
 * 从文本中提取 <think>...</think> 包裹的推理内容。
 * 部分上游（如某些开源模型/第三方）把推理放在 content 里用 <think> 标签包裹，
 * 而非使用 reasoning_content 字段。此函数将其拆分到 reasoning 列。
 * 支持流式增量：未闭合的 <think> 也会被正确识别为推理中。
 */
function extractThinkTagContent(text: string): { reasoning: string; body: string } {
	if (!text.includes('<think')) {
		return { reasoning: '', body: text };
	}
	let reasoning = '';
	let body = '';
	let remaining = text;
	// 处理所有完整的 <think>...</think> 块
	while (true) {
		const openIdx = remaining.indexOf('<think>');
		if (openIdx === -1) {
			// 检查是否有未闭合的 <think（流式增量中）
			const openTagIdx = remaining.indexOf('<think');
			if (openTagIdx !== -1) {
				// 找到 <think 起始位置，后面都是推理（未闭合）
				body += remaining.slice(0, openTagIdx);
				// 跳过整个 <think...> 标签（可能带属性），取标签后的内容
				const closeTagIdx = remaining.indexOf('>', openTagIdx);
				if (closeTagIdx !== -1) {
					reasoning += remaining.slice(closeTagIdx + 1);
				} else {
					// 连标签都不完整，全部当作推理中
					reasoning += remaining.slice(openTagIdx);
				}
			} else {
				body += remaining;
			}
			break;
		}
		// 正文：<think> 之前的部分
		body += remaining.slice(0, openIdx);
		const afterOpen = remaining.slice(openIdx + 7); // len('<think>') = 7
		const closeIdx = afterOpen.indexOf('</think>');
		if (closeIdx === -1) {
			// 未闭合的 <think>，剩余全是推理内容（流式增量中）
			reasoning += afterOpen;
			break;
		}
		reasoning += afterOpen.slice(0, closeIdx);
		remaining = afterOpen.slice(closeIdx + 8); // len('</think>') = 8
	}
	return { reasoning, body };
}

function appendOpenAiDeltaToParts(delta: Record<string, unknown>, parts: MergedAssistantParts): void {
	const rc = delta.reasoning_content;
	if (typeof rc === 'string' && rc.length > 0) {
		parts.reasoning += rc;
	}
	const th = delta.thinking;
	if (typeof th === 'string' && th.length > 0) {
		parts.reasoning += th;
	}
	const r = delta.reasoning;
	if (typeof r === 'string' && r.length > 0) {
		parts.reasoning += r;
	}
	const c = delta.content;
	if (typeof c === 'string' && c.length > 0) {
		// 检查 content 中是否包含 <think> 标签，若有则拆分到 reasoning/body
		const { reasoning, body } = extractThinkTagContent(c);
		if (reasoning) parts.reasoning += reasoning;
		if (body) parts.body += body;
	}
}

function mergeOpenAiSseParts(raw: string): MergedAssistantParts {
	const parts = emptyParts();
	for (const line of raw.split(/\r?\n/)) {
		const t = line.trim();
		if (!t.startsWith('data:')) {
			continue;
		}
		const payload = t.slice(5).trim();
		if (payload === '[DONE]' || payload === '') {
			continue;
		}
		let o: unknown;
		try {
			o = JSON.parse(payload);
		} catch {
			continue;
		}
		if (!o || typeof o !== 'object') {
			continue;
		}
		const choices = (o as { choices?: unknown }).choices;
		if (!Array.isArray(choices)) {
			continue;
		}
		for (const ch of choices) {
			if (!ch || typeof ch !== 'object') {
				continue;
			}
			const delta = (ch as { delta?: unknown }).delta;
			if (!delta || typeof delta !== 'object') {
				continue;
			}
			appendOpenAiDeltaToParts(delta as Record<string, unknown>, parts);
		}
	}
	return parts;
}

function mergeAnthropicSseParts(raw: string): MergedAssistantParts {
	const parts = emptyParts();
	let lastEvent = '';
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trimEnd();
		if (trimmed.startsWith('event:')) {
			lastEvent = trimmed.slice(6).trim();
			continue;
		}
		if (!trimmed.startsWith('data:')) {
			continue;
		}
		const dataStr = trimmed.slice(5).trim();
		if (dataStr === '' || dataStr === '[DONE]') {
			lastEvent = '';
			continue;
		}
		let o: unknown;
		try {
			o = JSON.parse(dataStr);
		} catch {
			lastEvent = '';
			continue;
		}
		if (!o || typeof o !== 'object') {
			lastEvent = '';
			continue;
		}
		const obj = o as Record<string, unknown>;
		const isDelta =
			lastEvent === 'content_block_delta' || obj.type === 'content_block_delta';
		if (isDelta) {
			const delta = obj.delta as Record<string, unknown> | undefined;
			if (!delta) {
				lastEvent = '';
				continue;
			}
			if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
				parts.reasoning += delta.thinking;
			}
			if (delta.type === 'text_delta' && typeof delta.text === 'string') {
				parts.body += delta.text;
			}
		}
		lastEvent = '';
	}
	return parts;
}

/** Gemini：带 `thought: true` 的 part 归入推理，其余有 text 的归入正文 */
function appendGeminiPartsToParts(partsArr: unknown, parts: MergedAssistantParts): void {
	if (!Array.isArray(partsArr)) {
		return;
	}
	for (const p of partsArr) {
		if (!p || typeof p !== 'object') {
			continue;
		}
		const part = p as { text?: unknown; thought?: unknown };
		if (typeof part.text !== 'string' || part.text.length === 0) {
			continue;
		}
		if (part.thought === true) {
			parts.reasoning += part.text;
		} else {
			parts.body += part.text;
		}
	}
}

function extractGeminiCandidatesParts(o: unknown): MergedAssistantParts {
	const parts = emptyParts();
	if (!o || typeof o !== 'object') {
		return parts;
	}
	const cands = (o as { candidates?: unknown }).candidates;
	if (!Array.isArray(cands) || cands.length === 0) {
		return parts;
	}
	const first = cands[0];
	if (!first || typeof first !== 'object') {
		return parts;
	}
	const content = (first as { content?: { parts?: unknown } }).content;
	appendGeminiPartsToParts(content?.parts, parts);
	return parts;
}

function mergeGeminiSseParts(raw: string): MergedAssistantParts {
	const acc = emptyParts();
	for (const line of raw.split(/\r?\n/)) {
		const t = line.trim();
		if (!t || t.startsWith(':')) {
			continue;
		}
		let jsonStr = t;
		if (t.startsWith('data:')) {
			jsonStr = t.slice(5).trim();
		}
		if (!jsonStr.startsWith('{') && !jsonStr.startsWith('[')) {
			continue;
		}
		let o: unknown;
		try {
			o = JSON.parse(jsonStr);
		} catch {
			continue;
		}
		const chunk = extractGeminiCandidatesParts(o);
		acc.reasoning += chunk.reasoning;
		acc.body += chunk.body;
	}
	return acc;
}

function mergeFromJsonObjectParts(o: unknown, protocol: PlaygroundProtocol): MergedAssistantParts {
	const parts = emptyParts();
	if (!o || typeof o !== 'object') {
		return parts;
	}
	if (protocol === 'openai') {
		const choices = (o as { choices?: unknown }).choices;
		if (!Array.isArray(choices) || choices.length === 0) {
			return parts;
		}
		const msg = (choices[0] as { message?: Record<string, unknown> }).message;
		if (!msg || typeof msg !== 'object') {
			return parts;
		}
		if (typeof msg.reasoning_content === 'string' && msg.reasoning_content.length > 0) {
			parts.reasoning += msg.reasoning_content;
		}
		if (typeof msg.thinking === 'string' && msg.thinking.length > 0) {
			parts.reasoning += msg.thinking;
		}
		const contentText = extractOpenAiMessageContent(msg.content);
		if (contentText) {
			const { reasoning: thinkReasoning, body: thinkBody } = extractThinkTagContent(contentText);
			parts.reasoning += thinkReasoning;
			parts.body += thinkBody;
		}
		return parts;
	}
	if (protocol === 'anthropic') {
		const blocks = (o as { content?: unknown }).content;
		if (!Array.isArray(blocks)) {
			return parts;
		}
		for (const b of blocks) {
			if (!b || typeof b !== 'object') {
				continue;
			}
			const block = b as { type?: unknown; text?: unknown; thinking?: unknown };
			if (block.type === 'thinking' && typeof block.thinking === 'string') {
				parts.reasoning += block.thinking;
			}
			if (block.type === 'text' && typeof block.text === 'string') {
				parts.body += block.text;
			}
		}
		return parts;
	}
	return extractGeminiCandidatesParts(o);
}

/**
 * 从原始报文拼接 / 抽取：推理类与正文分列。
 */
export function mergeAssistantTextParts(
	raw: string,
	protocol: PlaygroundProtocol,
	mode: PlaygroundResponseParseMode
): MergedAssistantParts {
	if (!raw.trim()) {
		return emptyParts();
	}
	if (mode === 'sse') {
		if (protocol === 'openai') {
			return mergeOpenAiSseParts(raw);
		}
		if (protocol === 'anthropic') {
			return mergeAnthropicSseParts(raw);
		}
		return mergeGeminiSseParts(raw);
	}
	if (mode === 'json') {
		try {
			const o = JSON.parse(raw) as unknown;
			return mergeFromJsonObjectParts(o, protocol);
		} catch {
			return emptyParts();
		}
	}
	try {
		const o = JSON.parse(raw) as unknown;
		if (o && typeof o === 'object') {
			return mergeFromJsonObjectParts(o, protocol);
		}
	} catch {
		// ignore
	}
	return emptyParts();
}

/**
 * 从原始报文拼接为单字符串（推理在前、正文在后，无分隔符；仅兼容旧用法）。
 */
export function mergeAssistantText(
	raw: string,
	protocol: PlaygroundProtocol,
	mode: PlaygroundResponseParseMode
): string {
	const p = mergeAssistantTextParts(raw, protocol, mode);
	return p.reasoning + p.body;
}
