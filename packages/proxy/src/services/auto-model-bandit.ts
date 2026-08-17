/**
 * Thompson Sampling Bandit：用于 auto 模式的模型选择。
 *
 * 借鉴 FreeLLMAPI 的 Beta 后验采样思想：
 * - 每个模型维护一个 Beta(α, β) 分布，α=成功次数+1，β=失败次数+1
 * - 每次选择时从各模型的 Beta 分布中采样，选均值最高的模型
 * - 自然实现探索(uncertain models)与利用(good models)的平衡
 * - 使用指数衰减窗口（half-life），让近期表现主导决策
 *
 * 与 route-stability-tracker 的区别：
 * - stability-tracker：滑动窗口布尔数组，纯确定性评分
 * - bandit：贝叶斯采样，带探索性，冷启动模型有机会被发现
 */

const MAX_SAMPLES = 50;
const DEFAULT_HALF_LIFE_MS = 2 * 24 * 60 * 60 * 1000; // 2 天半衰期
const EXPLORE_CHANCE = 0.1; // 10% 概率强制探索未知模型

type BanditEntry = {
	/** 指数加权成功次数 */
	alpha: number;
	/** 指数加权失败次数 */
	beta: number;
	/** 最近一次更新的时间戳 */
	lastUpdateMs: number;
	/** 总样本数（用于截断） */
	totalSamples: number;
};

const banditByModel = new Map<string, BanditEntry>();

/**
 * 从 Beta(α, β) 分布采样（使用正态近似，大数时足够精确）。
 * 对小样本使用均值 + 随机扰动的方式增加探索性。
 */
function sampleFromBeta(alpha: number, beta: number): number {
	if (alpha + beta < 4) {
		// 样本极少时随机探索
		return 0.3 + Math.random() * 0.4;
	}
	const mean = alpha / (alpha + beta);
	// Beta 分布的标准差近似
	const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
	const std = Math.sqrt(Math.max(variance, 0.0001));
	// Box-Muller 近似正态采样
	const u1 = Math.random();
	const u2 = Math.random();
	const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
	return Math.max(0, Math.min(1, mean + std * z * 0.5));
}

/**
 * 对 Bandit 条目应用指数衰减，使近期表现权重更高。
 */
function decayEntry(entry: BanditEntry, nowMs: number, halfLifeMs: number): void {
	const ageMs = nowMs - entry.lastUpdateMs;
	if (ageMs <= 0) return;
	const decayFactor = Math.exp(-0.693 * ageMs / halfLifeMs);
	entry.alpha = Math.max(1, entry.alpha * decayFactor);
	entry.beta = Math.max(1, entry.beta * decayFactor);
	entry.lastUpdateMs = nowMs;
	// 样本过多时均匀衰减，避免内存膨胀
	if (entry.totalSamples > MAX_SAMPLES) {
		const excess = entry.totalSamples - MAX_SAMPLES;
		const trimFactor = 1 - excess / (entry.totalSamples + 1);
		entry.alpha *= trimFactor;
		entry.beta *= trimFactor;
		entry.totalSamples = Math.min(entry.totalSamples, MAX_SAMPLES);
	}
}

/**
 * 记录一次成功。
 */
export function recordBanditSuccess(modelId: string, nowMs = Date.now()): void {
	const entry = banditByModel.get(modelId) ?? {
		alpha: 1,
		beta: 1,
		lastUpdateMs: nowMs,
		totalSamples: 0,
	};
	entry.alpha += 1;
	entry.totalSamples += 1;
	entry.lastUpdateMs = nowMs;
	banditByModel.set(modelId, entry);
}

/**
 * 记录一次失败。
 */
export function recordBanditFailure(modelId: string, nowMs = Date.now()): void {
	const entry = banditByModel.get(modelId) ?? {
		alpha: 1,
		beta: 1,
		lastUpdateMs: nowMs,
		totalSamples: 0,
	};
	entry.beta += 1;
	entry.totalSamples += 1;
	entry.lastUpdateMs = nowMs;
	banditByModel.set(modelId, entry);
}

/**
 * 获取模型的 Beta 分布期望值（用于确定性排序展示）。
 */
export function getBanditExpectedValue(modelId: string, nowMs = Date.now()): number {
	const entry = banditByModel.get(modelId);
	if (!entry) return 1;
	decayEntry(entry, nowMs, DEFAULT_HALF_LIFE_MS);
	return entry.alpha / (entry.alpha + entry.beta);
}

/**
 * 使用 Thompson Sampling 从候选模型中选择最优模型。
 * 对于无历史数据的模型，给予 10% 的探索概率。
 *
 * @param modelIds 候选模型 ID 列表
 * @param nowMs 当前时间戳
 * @returns 选中的模型 ID；列表为空时返回 null
 */
export function thompsonSampleBestModel(
	modelIds: string[],
	nowMs = Date.now()
): string | null {
	if (modelIds.length === 0) return null;
	if (modelIds.length === 1) return modelIds[0]!;

	const selected = modelIds.map((id) => {
		const entry = banditByModel.get(id);
		const hasData = entry != null && entry.totalSamples >= 3;
		// 探索：无数据或低置信度时随机采样
		if (!hasData && Math.random() < EXPLORE_CHANCE) {
			return { id, score: 0.5 + Math.random() * 0.5, isExploration: true };
		}
		const sampled = sampleFromBeta(
			entry?.alpha ?? 1,
			entry?.beta ?? 1
		);
		return { id, score: sampled, isExploration: false };
	});

	// 按采样分数降序，选最高的
	selected.sort((a, b) => b.score - a.score);
	return selected[0]!.id;
}

/**
 * 获取模型的可靠性评分（0-1，用于路由排序）。
 * 结合 Bandit 期望值和稳定性，比纯 Bandit 更稳定。
 */
export function getBanditReliabilityScore(
	modelId: string,
	stabilityScore: number,
	nowMs = Date.now()
): number {
	const entry = banditByModel.get(modelId);
	if (!entry || entry.totalSamples < 3) {
		// 无数据时返回稳定性评分，不惩罚冷启动
		return stabilityScore;
	}
	decayEntry(entry, nowMs, DEFAULT_HALF_LIFE_MS);
	const banditScore = entry.alpha / (entry.alpha + entry.beta);
	// 加权组合：Bandit 70% + 稳定性 30%，防止短期波动
	return banditScore * 0.7 + stabilityScore * 0.3;
}

/** 测试用：清空所有 Bandit 状态。 */
export function resetBanditStateForTests(): void {
	banditByModel.clear();
}
