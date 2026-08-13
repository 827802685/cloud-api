/**
 * Auto 模型选择器：当客户端发送 `model: "auto"` 时，从所有可用模型中选择最佳模型。
 *
 * 选择策略：
 * 1. 获取所有有活跃路由的模型（已由 listModelsWithActiveRoutes 过滤）
 * 2. 按 context_window 从大到小排序，优先选择能力最强的模型
 * 3. 同等 context_window 时，按厂商偏好和模型 ID 稳定排序
 * 4. 返回排序后的候选列表，供 failover 在首选模型配额耗尽/失败时自动切换到下一个模型
 * 5. 实际的 provider 健康检查由 failover dispatch 负责
 */
import type { GatewayRepositories, ModelRow } from '@cloud-api/core';
import { getRouteStabilityScore } from './route-stability-tracker';

/** Auto 模型选择结果 */
export interface AutoModelSelection {
  model: ModelRow;
  modelId: string;
}

/** 缓存：避免每次请求都查询数据库 */
let cachedModels: ModelRow[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 60 秒缓存

/** 默认候选数量上限（auto 跨模型 failover 时最多合并多少个模型的路由） */
export const AUTO_MODEL_CANDIDATE_LIMIT = 5;

/**
 * 对候选模型排序：厂商偏好 → context_window 降序 → 稳定性评分降序 → 模型 ID 稳定排序。
 * 稳定性评分来自 route-stability-tracker（无数据返回 1，不惩罚冷启动）。
 */
function sortModelCandidates(models: ModelRow[], preferredVendor?: string): ModelRow[] {
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

    // 稳定性评分降序（稳定性高的优先）
    const aStab = getRouteStabilityScore(a.id);
    const bStab = getRouteStabilityScore(b.id);
    if (aStab !== bStab) {
      return bStab - aStab;
    }

    // 按模型 ID 字母序稳定排序
    return a.id.localeCompare(b.id);
  });
  return sorted;
}

async function getCachedModels(repos: GatewayRepositories): Promise<ModelRow[] | null> {
  const now = Date.now();
  if (!cachedModels || now - cacheTimestamp > CACHE_TTL_MS) {
    try {
      cachedModels = await repos.modelRouting.listModelsWithActiveRoutes();
      cacheTimestamp = now;
      console.log(`[AutoModel] refreshed cache, ${cachedModels.length} models available`);
    } catch (err) {
      console.error('[AutoModel] failed to list models', err);
      return null;
    }
  }
  return cachedModels;
}

/**
 * 返回排序后的候选模型列表（供 auto 跨模型 failover 使用）。
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
  const sorted = sortModelCandidates(models, preferredVendor);
  return sorted.slice(0, Math.max(1, limit));
}

/**
 * 从所有可用模型中选择最佳模型。
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
  cachedModels = null;
  cacheTimestamp = 0;
}
