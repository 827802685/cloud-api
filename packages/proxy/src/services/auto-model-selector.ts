/**
 * Auto 模型选择器：当客户端发送 `model: "auto"` 时，从所有可用模型中选择最佳模型。
 *
 * 选择策略（参考 freellmapi 的 Thompson Sampling Bandit）：
 * 1. 获取所有有活跃路由的模型（已由 listModelsWithActiveRoutes 过滤）
 * 2. 对每个模型计算综合评分：
 *    - Bandit 可靠性分（Beta 分布期望值，指数衰减窗口 2天半衰期）
 *    - Route 稳定性分（滑动窗口 48 样本）
 *    - context_window（能力指标）
 * 3. Thompson Sampling：带探索性的采样选择，冷启动模型有机会被发现
 * 4. 返回排序后的候选列表，供 failover 在首选模型配额耗尽/失败时自动切换到下一个模型
 * 5. 实际的 provider 健康检查由 failover dispatch 负责
 *
 * 注意：auto 不按请求协议过滤模型。选中模型后若该模型缺少当前请求协议
 * （如 openai）的路由，`resolveRoutesForSurface` 会自动创建该协议路由，
 * 从而保证出站统一走请求协议（如 OpenAI 格式）。
 */
import type { GatewayRepositories, ModelRow } from '@cloud-api/core';
import { getRouteStabilityScore } from './route-stability-tracker';
import {
	getBanditReliabilityScore,
	recordBanditSuccess,
	recordBanditFailure,
	thompsonSampleBestModel,
	resetBanditStateForTests,
} from './auto-model-bandit';

/** Auto 模型选择结果 */
export interface AutoModelSelection {
  model: ModelRow;
  modelId: string;
}

/** 缓存：避免每次请求都查询数据库 */
const modelCache = new Map<string, { models: ModelRow[]; timestamp: number }>();
const CACHE_TTL_MS = 60_000; // 60 秒缓存

/** 默认候选数量上限（auto 跨模型 failover 时最多合并多少个模型的路由） */
export const AUTO_MODEL_CANDIDATE_LIMIT = 5;

/**
 * 对候选模型排序：厂商偏好 → context_window 降序 → 综合可靠性评分降序 → 模型 ID 稳定排序。
 * 综合可靠性评分 = Bandit 期望值(70%) + 稳定性分(30%)，无数据时退回稳定性分。
 */
function sortModelCandidates(models: ModelRow[], preferredVendor?: string, nowMs = Date.now()): ModelRow[] {
	const sorted = [...models];
	sorted.sort((a, b) => {
		// 如果指定了偏好厂商，优先选择该厂商的模型
		if (preferredVendor) {
			const aMatch = a.vendor === preferredVendor ? 1 : 0;
			const bMatch = b.vendor === preferredVendor ? 1 : 0;
			if (aMatch !== bMatch) return bMatch - aMatch;
		}

		// 按 context_window 降序
		const aCtx = a.context_window ?? 0;
		const bCtx = b.context_window ?? 0;
		if (aCtx !== bCtx) {
			return bCtx - aCtx;
		}

		// 综合可靠性评分：Bandit(70%) + 稳定性(30%)
		const aStab = getRouteStabilityScore(a.id, nowMs);
		const bStab = getRouteStabilityScore(b.id, nowMs);
		const aReliability = getBanditReliabilityScore(a.id, aStab, nowMs);
		const bReliability = getBanditReliabilityScore(b.id, bStab, nowMs);
		if (Math.abs(aReliability - bReliability) > 0.01) {
			return bReliability - aReliability;
		}
		// 相近时再用纯稳定性微调
		if (Math.abs(aStab - bStab) > 0.05) {
			return bStab - aStab;
		}

		// 按模型 ID 字母序稳定排序
		return a.id.localeCompare(b.id);
	});
	return sorted;
}

async function getCachedModels(repos: GatewayRepositories): Promise<ModelRow[] | null> {
  const now = Date.now();
  const entry = modelCache.get('*');
  if (!entry || now - entry.timestamp > CACHE_TTL_MS) {
    try {
      const models = await repos.modelRouting.listModelsWithActiveRoutes();
      modelCache.set('*', { models, timestamp: now });
      console.log(`[AutoModel] refreshed cache, ${models.length} models available`);
      return models;
    } catch (err) {
      console.error('[AutoModel] failed to list models', err);
      return null;
    }
  }
  return entry.models;
}

/**
 * 返回排序后的候选模型列表（供 auto 跨模型 failover 使用）。
 * 使用 Thompson Sampling Bandit + 综合可靠性评分进行排序。
 * @param repos 网关仓储
 * @param preferredVendor 可选的厂商标识（如 "nvidia"），用于偏好选择
 * @param limit 返回的候选数量上限
 * @returns 排序后的模型列表；无可用模型时返回空数组
 */
export async function selectAutoModelCandidates(
	repos: GatewayRepositories,
	preferredVendor?: string,
	limit: number = AUTO_MODEL_CANDIDATE_LIMIT
): Promise<ModelRow[]> {
	const models = await getCachedModels(repos);
	if (!models || models.length === 0) {
		return [];
	}
	const nowMs = Date.now();
	const sorted = sortModelCandidates(models, preferredVendor, nowMs);
	return sorted.slice(0, Math.max(1, limit));
}

/**
 * 使用 Thompson Sampling 从候选模型中选择最优模型（带探索性）。
 * 适用于需要动态选择而非固定首选项的场景。
 * @param repos 网关仓储
 * @param preferredVendor 可选的厂商标识
 * @returns 选中的模型 ID；无可用模型时返回 null
 */
export async function selectAutoModelWithBandit(
	repos: GatewayRepositories,
	preferredVendor?: string
): Promise<string | null> {
	const models = await getCachedModels(repos);
	if (!models || models.length === 0) {
		return null;
	}
	const nowMs = Date.now();
	const candidateIds = sortModelCandidates(models, preferredVendor, nowMs).map((m) => m.id);
	return thompsonSampleBestModel(candidateIds, nowMs);
}

/**
 * 从所有可用模型中选择最佳模型（确定性排序，适用于兜底场景）。
 * @param repos 网关仓储
 * @param preferredVendor 可选的厂商标识（如 "nvidia"），用于偏好选择
 * @returns 选中的模型，无可用模型时返回 null
 */
export async function selectAutoModel(
	repos: GatewayRepositories,
	preferredVendor?: string
): Promise<AutoModelSelection | null> {
	const candidates = await selectAutoModelCandidates(repos, preferredVendor, 1);
	const best = candidates[0];
	if (!best) {
		return null;
	}
	console.log(
		`[AutoModel] selected model=${best.id} contextWindow=${best.context_window ?? 'unknown'} vendor=${best.vendor}`
	);

	return {
		model: best,
		modelId: best.id,
	};
}

/** 清除缓存（用于测试或模型变更后） */
export function clearAutoModelCache(): void {
	modelCache.clear();
}

export { recordBanditSuccess, recordBanditFailure, resetBanditStateForTests };
