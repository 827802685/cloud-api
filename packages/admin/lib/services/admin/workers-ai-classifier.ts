/**
 * Workers AI 智能归类客户端：用于 RSS 免费模型同步时对模型做智能分类。
 *
 * 双通道：
 * 1. `env.AI` binding（Cloudflare Workers AI binding，`AI.run(model, inputs)`）
 * 2. REST API（`CF_API_TOKEN` + `CF_ACCOUNT_ID`，`POST /accounts/{id}/ai/run/{model}`）
 *
 * 未配置任何通道或调用失败时返回 null，调用方（RSS 同步）降级为启发式归类。
 * 使用文档推荐的 `@cf/meta/llama-3.1-8b-instruct-fast` 做结构化 JSON 提取。
 */

/** 与 `RssModelKind` 对齐的归类结果种类。 */
export type WorkersAiModelKind =
	| 'chat'
	| 'vision'
	| 'image'
	| 'audio-asr'
	| 'audio-tts'
	| 'embedding'
	| 'video'
	| 'rerank'
	| 'special';

/** Workers AI 归类结果。 */
export type WorkersAiClassification = {
	kind: WorkersAiModelKind;
	/** 置信度 0-1 */
	confidence: number;
	/** 归类依据（简短） */
	rationale: string;
};

/** 待归类模型的输入信息。 */
export type WorkersAiClassifyInput = {
	id: string;
	displayName: string | null;
	description: string | null;
	/** RSS 能力标签（chat/video/image/audio...） */
	capabilities: string[];
	/** RSS 中文分类标签（对话、代码、向量嵌入、图像生成、推理、视觉理解、视频生成、语音/音频...） */
	categories?: string[];
};

/** Workers AI 归类器接口。 */
export type WorkersAiClassifier = {
	classify(model: WorkersAiClassifyInput): Promise<WorkersAiClassification | null>;
};

/** Workers AI binding 的最小接口（`env.AI`）。 */
export type WorkersAiBinding = {
	run(model: string, inputs: Record<string, unknown>): Promise<{
		response?: string;
		text?: string;
		output?: string;
	}>;
};

/** 归类器可用的环境配置。 */
export type WorkersAiClassifierEnv = {
	/** Workers AI binding（`env.AI`） */
	AI?: WorkersAiBinding | unknown;
	/** Cloudflare API Token（REST 通道） */
	CF_API_TOKEN?: string;
	/** Cloudflare Account ID（REST 通道） */
	CF_ACCOUNT_ID?: string;
};

/** 归类用的 Workers AI 模型。 */
export const WORKERS_AI_CLASSIFY_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

/** 归类 prompt 中允许的种类（与网关可服务能力对齐）。 */
const ALLOWED_KINDS = [
	'chat',
	'vision',
	'image',
	'audio-asr',
	'audio-tts',
	'embedding',
	'video',
	'rerank',
	'special',
] as const;

const SYSTEM_PROMPT = `You are a model catalog classifier. Given a model's id, display name, description and capability tags, classify it into EXACTLY ONE kind.
Allowed kinds:
- chat: text-only LLM for conversation / completion
- vision: multimodal LLM (accepts image/audio input, outputs text)
- image: text-to-image / image generation or editing
- audio-asr: speech-to-text / transcription
- audio-tts: text-to-speech
- embedding: vector embeddings
- video: video generation / editing
- rerank: document reranking
- special: safety guard, reward, moderation, parsing, evaluation, classifier
Return ONLY JSON: {"kind":"<one of the above>","confidence":0.0-1.0,"rationale":"short reason"}.`;

function parseKind(raw: string): WorkersAiModelKind | null {
	const v = raw.trim().toLowerCase();
	return (ALLOWED_KINDS as readonly string[]).includes(v) ? (v as WorkersAiModelKind) : null;
}

function parseClassification(content: string): WorkersAiClassification | null {
	// 提取首个 JSON 对象（模型可能夹带前后缀文本）
	const start = content.indexOf('{');
	const end = content.lastIndexOf('}');
	if (start < 0 || end <= start) return null;
	try {
		const parsed = JSON.parse(content.slice(start, end + 1)) as {
			kind?: unknown;
			confidence?: unknown;
			rationale?: unknown;
		};
		const kind = parseKind(typeof parsed.kind === 'string' ? parsed.kind : '');
		if (!kind) return null;
		const confidence =
			typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
		return {
			kind,
			confidence,
			rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
		};
	} catch {
		return null;
	}
}

function buildUserPrompt(model: WorkersAiClassifyInput): string {
	const caps = model.capabilities.length > 0 ? model.capabilities.join(', ') : '(none)';
	const cats = model.categories && model.categories.length > 0 ? model.categories.join(', ') : '(none)';
	return [
		`Model ID: ${model.id}`,
		`Display name: ${model.displayName ?? ''}`,
		`Description: ${model.description ?? ''}`,
		`Capability tags: ${caps}`,
		`Category tags: ${cats}`,
	].join('\n');
}

/** 通过 `env.AI` binding 调用。 */
async function classifyViaBinding(
	ai: WorkersAiBinding,
	model: WorkersAiClassifyInput
): Promise<WorkersAiClassification | null> {
	if (typeof ai.run !== 'function') return null;
	const out = await ai.run(WORKERS_AI_CLASSIFY_MODEL, {
		messages: [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: buildUserPrompt(model) },
		],
	});
	const content = out.response ?? out.text ?? out.output;
	if (!content) return null;
	return parseClassification(content);
}

/** 通过 REST API 调用（`CF_API_TOKEN` + `CF_ACCOUNT_ID`）。 */
async function classifyViaRest(
	token: string,
	accountId: string,
	model: WorkersAiClassifyInput
): Promise<WorkersAiClassification | null> {
	const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
		accountId
	)}/ai/run/${encodeURIComponent(WORKERS_AI_CLASSIFY_MODEL)}`;
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: buildUserPrompt(model) },
			],
		}),
	});
	if (!res.ok) return null;
	const data = (await res.json()) as {
		result?: { response?: string; text?: string; output?: string };
		success?: boolean;
	};
	if (data.success === false) return null;
	const content = data.result?.response ?? data.result?.text ?? data.result?.output;
	if (!content) return null;
	return parseClassification(content);
}

/**
 * 创建 Workers AI 归类器。
 * 优先使用 `env.AI` binding；否则用 REST 通道（需 `CF_API_TOKEN` + `CF_ACCOUNT_ID`）。
 * 无可用通道时返回 null（调用方降级为启发式归类）。
 */
export function createWorkersAiClassifier(env: WorkersAiClassifierEnv): WorkersAiClassifier | null {
	const ai = env.AI as WorkersAiBinding | undefined;
	const hasBinding = ai != null && typeof (ai as { run?: unknown }).run === 'function';
	const hasRest =
		typeof env.CF_API_TOKEN === 'string' &&
		env.CF_API_TOKEN.trim() !== '' &&
		typeof env.CF_ACCOUNT_ID === 'string' &&
		env.CF_ACCOUNT_ID.trim() !== '';

	if (!hasBinding && !hasRest) return null;

	return {
		async classify(model: WorkersAiClassifyInput): Promise<WorkersAiClassification | null> {
			if (hasBinding && ai) {
				try {
					const result = await classifyViaBinding(ai, model);
					if (result) return result;
				} catch {
					// 降级到 REST 通道
				}
			}
			if (hasRest && env.CF_API_TOKEN && env.CF_ACCOUNT_ID) {
				try {
					return await classifyViaRest(env.CF_API_TOKEN, env.CF_ACCOUNT_ID, model);
				} catch {
					return null;
				}
			}
			return null;
		},
	};
}
