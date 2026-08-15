/**
 * 解析请求体里的 `model` 字符串：`baseId` 与可选后缀 `baseId:route_group`（显式指定计费通道）。
 * 支持 `auto` 和 `auto:vendor` 语法，自动选择最佳可用模型。
 */
import type { GatewayRepositories, ModelRow } from '@cloud-api/core';
import { selectAutoModelCandidates, AUTO_MODEL_CANDIDATE_LIMIT } from './auto-model-selector';

export interface ResolvedModelRouting {
  model: ModelRow;
  /** `models` 表中的规范 id（无 `:group` 后缀） */
  baseModelId: string;
  /** 仅来自 `baseId:group` 后缀；为 null 时选路使用 **`default`** 路由组 */
  explicitGroup: string | null;
  /** 是否为 auto 选择（用于日志和响应头） */
  isAutoSelected?: boolean;
  /** 仅 auto：排序后的候选模型列表，供 failover 跨模型切换（首选在首位） */
  autoCandidates?: ModelRow[];
}

/**
 * 将 OpenAI 风格 `model`（及 Gemini 路径中的模型段）解析为库中行 + 可选 route_group。
 * 整串命中 id → explicitGroup 为 null；否则按最后一个 `:` 切分，前缀为模型 id、后缀为显式路由组。
 * 支持 `auto` 和 `auto:vendor` 语法自动选择最佳模型。
 *
 * auto 从所有有活跃路由的模型中选择（不按协议过滤）；选中模型后若缺少当前请求协议
 * 路由，`resolveRoutesForSurface` 会自动创建该协议路由，保证出站统一走请求协议格式。
 *
 * @param repos 网关仓储
 * @param rawModelId 客户端传入的 model 字符串（可含前后空格，内部 trim）
 * @returns 无法匹配任一模型 id 时 `null`
 */
export async function resolveModelRouting(
  repos: GatewayRepositories,
  rawModelId: string
): Promise<ResolvedModelRouting | null> {
  const t = rawModelId.trim();
  if (!t) {
    return null;
  }

  // 处理 auto 模型选择
  if (t === 'auto' || t.startsWith('auto:')) {
    const preferredVendor = t.includes(':') ? t.slice(5).trim() : undefined;
    const candidates = await selectAutoModelCandidates(
      repos,
      preferredVendor || undefined,
      AUTO_MODEL_CANDIDATE_LIMIT
    );
    if (candidates.length === 0) {
      console.warn('[AutoModel] no available models found');
      return null;
    }
    const selected = candidates[0]!;
    return {
      model: selected,
      baseModelId: selected.id,
      explicitGroup: null,
      isAutoSelected: true,
      autoCandidates: candidates,
    };
  }

  const direct = await repos.modelRouting.getModelById(t);
  if (direct) {
    return {
      model: direct,
      baseModelId: t,
      explicitGroup: null,
    };
  }

  const idx = t.lastIndexOf(':');
  if (idx <= 0 || idx >= t.length - 1) {
    return null;
  }

  const baseId = t.slice(0, idx).trim();
  const groupSuffix = t.slice(idx + 1).trim();
  if (!baseId || !groupSuffix) {
    return null;
  }

  const baseRow = await repos.modelRouting.getModelById(baseId);
  if (!baseRow) {
    return null;
  }

  return {
    model: baseRow,
    baseModelId: baseId,
    explicitGroup: groupSuffix,
  };
}
