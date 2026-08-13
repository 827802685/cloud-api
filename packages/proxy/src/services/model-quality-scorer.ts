/**
 * 四维模型质量评分：稳定性 × 参数量 × 上下文长度 × 免费额度。
 *
 * 用途：为免费模型接入提供「推荐初始权重」，并可在运行时结合
 * `route-stability-tracker` 的动态稳定性评分得到综合权重。
 *
 * 四个维度各自归一化到 0-1，综合分 = 各维度加权乘积（任一维度为 0 则整体为 0，
 * 避免「参数量巨大但极不稳定」或「免费但上下文极短」的模型被高估）。
 *
 * 说明：
 * - 参数量 / 上下文 / 免费额度为静态维度，来自模型元数据或接入时人工标注。
 * - 稳定性为动态维度，来自 `getRouteStabilityScore`（含 Playground 测试台计入）。
 * - Workers AI 归类：见 `classifyWithWorkersAI`（需 Cloudflare Workers AI binding，未配置时跳过）。
 */

export type FreeQuotaTier = 'unlimited' | 'monthly' | 'trial' | 'none';

export type ModelQualityInput = {
	/** 模型总参数量（十亿，B）。MoE 用总参数量（含非活跃专家）。 */
	paramsB: number | null;
	/** 上下文窗口（token 数）。 */
	contextWindow: number | null;
	/** 免费额度档位。 */
	freeQuota: FreeQuotaTier;
	/** 动态稳定性评分（0-1），来自 route-stability-tracker；缺省 1（冷启动不惩罚）。 */
	stabilityScore?: number;
};

export type ModelQualityScore = {
	/** 参数量维度 0-1 */
	paramsScore: number;
	/** 上下文维度 0-1 */
	contextScore: number;
	/** 免费额度维度 0-1 */
	freeScore: number;
	/** 稳定性维度 0-1 */
	stabilityScore: number;
	/** 综合分 0-1（四维乘积） */
	composite: number;
	/** 推荐初始权重（1-100，供 `model_routes.weight` 参考） */
	recommendedWeight: number;
};

/** 参数量评分：对数刻度，越大越高。0B→0.25，1B→0.33，10B→0.51，100B→0.75，1T→1。 */
export function scoreParams(paramsB: number | null): number {
	if (paramsB == null || paramsB <= 0) return 0.25;
	return Math.min(1, 0.25 + Math.log10(paramsB + 1) * 0.25);
}

/** 上下文评分：对数刻度。1k→0.3，8k→0.45，32k→0.55，128k→0.7，1M→0.9。 */
export function scoreContext(contextWindow: number | null): number {
	if (contextWindow == null || contextWindow <= 0) return 0.4;
	return Math.min(1, 0.25 + Math.log10(contextWindow) * 0.13);
}

/** 免费额度评分：unlimited=1，monthly=0.75，trial=0.5，none=0.2。 */
export function scoreFreeQuota(tier: FreeQuotaTier): number {
	switch (tier) {
		case 'unlimited':
			return 1;
		case 'monthly':
			return 0.75;
		case 'trial':
			return 0.5;
		case 'none':
			return 0.2;
	}
}

/** 四维综合评分。 */
export function scoreModelQuality(input: ModelQualityInput): ModelQualityScore {
	const paramsScore = scoreParams(input.paramsB);
	const contextScore = scoreContext(input.contextWindow);
	const freeScore = scoreFreeQuota(input.freeQuota);
	const stabilityScore =
		typeof input.stabilityScore === 'number'
			? Math.max(0, Math.min(1, input.stabilityScore))
			: 1;

	const composite = paramsScore * contextScore * freeScore * stabilityScore;

	// 推荐初始权重：综合分映射到 1-100（线性放大，至少 1）
	const recommendedWeight = Math.max(1, Math.round(composite * 100));

	return {
		paramsScore,
		contextScore,
		freeScore,
		stabilityScore,
		composite,
		recommendedWeight,
	};
}

/** Workers AI 归类结果。 */
export type WorkersAiClassification = {
	/** 能力标签，如 `chat`、`reasoning`、`coding`、`vision`、`agentic` */
	capabilities: string[];
	/** 用途归类，如 `general`、`coding`、`reasoning`、`multimodal` */
	category: string;
	/** 置信度 0-1 */
	confidence: number;
	/** 归类依据（简短） */
	rationale: string;
};

/** Cloudflare Workers AI binding 的最小接口（`env.AI`）。 */
export type WorkersAiBinding = {
	run(model: string, inputs: Record<string, unknown>): Promise<{
		response?: string;
		text?: string;
		output?: string;
	}>;
};

/**
 * 调用 Cloudflare Workers AI 对模型做智能归类。
 * 需要 Workers AI binding（`env.AI`）；未配置或调用失败时返回 null（调用方降级为启发式归类）。
 * 使用文档推荐的 `@cf/meta/llama-3.1-8b-instruct-fast` 做结构化 JSON 提取。
 */
export async function classifyWithWorkersAI(
	model: { id: string; displayName: string | null; description: string | null },
	ai: WorkersAiBinding | null | undefined
): Promise<WorkersAiClassification | null> {
	if (!ai || typeof ai.run !== 'function') return null;
	try {
		const out = await ai.run('@cf/meta/llama-3.1-8b-instruct-fast', {
			messages: [
				{
					role: 'system',
					content:
						'You classify AI models. Return ONLY JSON: {"capabilities":["chat","reasoning","coding","vision","agentic"],"category":"general|coding|reasoning|multimodal","confidence":0.0-1.0,"rationale":"short reason"}.',
				},
				{
					role: 'user',
					content: `Model ID: ${model.id}\nDisplay name: ${model.displayName ?? ''}\nDescription: ${model.description ?? ''}`,
				},
			],
		});
		const content = out.response ?? out.text ?? out.output;
		if (!content) return null;
		const parsed = JSON.parse(content) as Partial<WorkersAiClassification>;
		return {
			capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities : ['chat'],
			category: typeof parsed.category === 'string' ? parsed.category : 'general',
			confidence:
				typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
			rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
		};
	} catch {
		return null;
	}
}
