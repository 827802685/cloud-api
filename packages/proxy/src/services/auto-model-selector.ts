/**
 * Auto 模型选择器：当客户端发送 `model: "auto"` 时，从所有可用模型中选择最佳模型。
 *
 * 选择策略（简化版）：
 * 1. 获取所有有活跃路由的模型（已由 listModelsWithActiveRoutes 过滤）
 * 2. 按 context_window 从大到小排序，优先选择能力最强的模型
 * 3. 同等 context_window 时，按厂商偏好和模型 ID 稳定排序
 * 4. 实际的 provider 健康检查由 failover dispatch 负责
 */
import type { GatewayRepositories, ModelRow } from '@cloud-api/core';

/** Auto 模型选择结果 */
export interface AutoModelSelection {
  model: ModelRow;
  modelId: string;
}

/** 缓存：避免每次请求都查询数据库 */
let cachedModels: ModelRow[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 60 秒缓存

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
  const now = Date.now();

  // 使用缓存减少数据库查询
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

  const models = cachedModels;
  if (!models || models.length === 0) {
    return null;
  }

  // 复制一份避免修改缓存
  const sorted = [...models];

  // 排序：优先选择 context_window 大、有活跃路由的模型
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

    // 按模型 ID 字母序稳定排序
    return a.id.localeCompare(b.id);
  });

  const best = sorted[0]!;
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
