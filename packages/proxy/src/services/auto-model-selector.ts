/**
 * Auto 模型选择器：当客户端发送 `model: "auto"` 时，从所有可用模型中选择最佳模型。
 *
 * 选择策略：
 * 1. 获取所有有活跃路由的模型
 * 2. 过滤掉所有 provider 处于熔断冷却中的模型
 * 3. 按 context_window 从大到小排序，优先选择能力最强的模型
 * 4. 同等 context_window 时，按路由数量排序（多路由 = 更高可用）
 */
import type { GatewayRepositories, ModelRow } from '@octafuse/core';
import { getProviderCircuitRemainingMs } from './provider-circuit-breaker';

/** Auto 模型选择结果 */
export interface AutoModelSelection {
  model: ModelRow;
  modelId: string;
  healthyRouteCount: number;
}

/** 缓存：避免每次请求都查询数据库 */
let cachedModels: ModelRow[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000; // 30 秒缓存

/**
 * 从所有可用模型中选择最佳模型。
 * @param repos 网关仓储
 * @param preferredVendor 可选的厂商标识（如 "openai"），用于偏好选择
 * @returns 选中的模型，无可用模型时返回 null
 */
export async function selectAutoModel(
  repos: GatewayRepositories,
  preferredVendor?: string
): Promise<AutoModelSelection | null> {
  const now = Date.now();

  // 使用缓存减少数据库查询
  if (!cachedModels || now - cacheTimestamp > CACHE_TTL_MS) {
    try {
      cachedModels = await repos.modelRouting.listModelsWithActiveRoutes();
      cacheTimestamp = now;
    } catch (err) {
      console.error('[AutoModel] failed to list models', err);
      return null;
    }
  }

  const models = cachedModels;
  if (!models || models.length === 0) {
    return null;
  }

  // 为每个模型计算健康路由数量
  const modelScores: Array<{
    model: ModelRow;
    healthyRoutes: number;
    totalRoutes: number;
  }> = [];

  for (const model of models) {
    const routes = await repos.modelRouting.getModelRoutesByModelId(model.id);
    const activeRoutes = routes.filter((r) => r.status === 'active');

    let healthyRoutes = 0;
    for (const route of activeRoutes) {
      // 检查 provider 是否在熔断中
      const remaining = getProviderCircuitRemainingMs(route.provider_id, now);
      if (remaining <= 0) {
        healthyRoutes++;
      }
    }

    if (healthyRoutes > 0) {
      modelScores.push({
        model,
        healthyRoutes,
        totalRoutes: activeRoutes.length,
      });
    }
  }

  if (modelScores.length === 0) {
    return null;
  }

  // 排序：优先选择健康路由多、context_window 大的模型
  modelScores.sort((a, b) => {
    // 如果指定了偏好厂商，优先选择该厂商的模型
    if (preferredVendor) {
      const aMatch = a.model.vendor === preferredVendor ? 1 : 0;
      const bMatch = b.model.vendor === preferredVendor ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
    }

    // 按健康路由数量降序
    if (a.healthyRoutes !== b.healthyRoutes) {
      return b.healthyRoutes - a.healthyRoutes;
    }

    // 按 context_window 降序
    const aCtx = a.model.context_window ?? 0;
    const bCtx = b.model.context_window ?? 0;
    if (aCtx !== bCtx) {
      return bCtx - aCtx;
    }

    // 按模型 ID 字母序稳定排序
    return a.model.id.localeCompare(b.model.id);
  });

  const best = modelScores[0]!;
  console.log(
    `[AutoModel] selected model=${best.model.id} healthyRoutes=${best.healthyRoutes} contextWindow=${best.model.context_window ?? 'unknown'}`
  );

  return {
    model: best.model,
    modelId: best.model.id,
    healthyRouteCount: best.healthyRoutes,
  };
}

/** 清除缓存（用于测试或模型变更后） */
export function clearAutoModelCache(): void {
  cachedModels = null;
  cacheTimestamp = 0;
}
