/**
 * 将协议已过滤的 routes 编排为本次请求的尝试序列：
 * priority 硬序（DESC）→ 层内按 route strategy 排序 → 过滤熔断中的 provider → 按速率健康评分微调。
 */
import type { RouteStrategyName } from '@cloud-api/core';
import type { RouteResult } from './model-router';
import { getProviderCircuitRemainingMs } from './provider-circuit-breaker';
import { ROUTE_STRATEGIES } from './route-strategies';
import { getProviderHealthScore } from './provider-rate-tracker';
import { getRouteStabilityScore } from './route-stability-tracker';

export type RouteAttemptPlan = {
	attempts: RouteResult[];
	earliestRetryAfterMs: number | null;
	skippedByCircuit: number;
	/** 因速率限制评分低而被降序的 provider 数量 */
	rateLimitedCount: number;
};

function groupRoutesByPriorityDesc(routes: RouteResult[]): Array<{ priority: number; routes: RouteResult[] }> {
	const groups = new Map<number, RouteResult[]>();
	for (const route of routes) {
		const bucket = groups.get(route.routePriority) ?? [];
		bucket.push(route);
		groups.set(route.routePriority, bucket);
	}
	return [...groups.entries()]
		.sort((a, b) => b[0] - a[0])
		.map(([priority, tierRoutes]) => ({ priority, routes: tierRoutes }));
}

/**
 * 构建本次请求的 route 尝试计划。
 * `tierOverrides` 按 priority 覆盖 `strategyName`（未配置的层仍用 base）。
 * 集成速率限制健康评分：策略排序后，按健康评分微调顺序（健康分低的 provider 往后排）。
 */
export function buildRouteAttemptPlan(
	routes: RouteResult[],
	ctx: { affinityKey: string; tierKeyPrefix: string },
	strategyName: RouteStrategyName,
	now = Date.now(),
	tierOverrides?: ReadonlyMap<number, RouteStrategyName> | null
): RouteAttemptPlan {
	const attempts: RouteResult[] = [];
	let earliestRetryAfterMs: number | null = null;
	let skippedByCircuit = 0;
	let rateLimitedCount = 0;

	const trackRetryAfter = (ms: number): void => {
		if (earliestRetryAfterMs == null || ms < earliestRetryAfterMs) {
			earliestRetryAfterMs = ms;
		}
	};

	for (const tier of groupRoutesByPriorityDesc(routes)) {
		const name = tierOverrides?.get(tier.priority) ?? strategyName;
		const strategy = ROUTE_STRATEGIES[name] ?? ROUTE_STRATEGIES.hash_affinity;
		const ordered = strategy(tier.routes, {
			affinityKey: ctx.affinityKey,
			tierKey: `${ctx.tierKeyPrefix}|${tier.priority}`,
		});

		// 按速率健康评分微调排序：健康分高的优先
		const scored = ordered.map((route) => ({
			route,
			healthScore: getProviderHealthScore(route.providerId, now),
			stabilityScore: getRouteStabilityScore(route.targetId, now),
		}));

		// 稳定排序：同等健康分保持原策略排序
		scored.sort((a, b) => {
			// 健康分为 0 的（已超限）排到最后
			if (a.healthScore === 0 && b.healthScore > 0) return 1;
			if (b.healthScore === 0 && a.healthScore > 0) return -1;
			// 健康分差异大于阈值时调整顺序
			if (Math.abs(a.healthScore - b.healthScore) > 0.1) {
				return b.healthScore - a.healthScore;
			}
			// 健康分相近时，用稳定性评分微调（稳定性高的优先）
			if (Math.abs(a.stabilityScore - b.stabilityScore) > 0.05) {
				return b.stabilityScore - a.stabilityScore;
			}
			return 0; // 保持原策略排序
		});

		for (const { route, healthScore } of scored) {
			const remaining = getProviderCircuitRemainingMs(route.providerId, now);
			if (remaining > 0) {
				skippedByCircuit += 1;
				trackRetryAfter(remaining);
				continue;
			}
			if (healthScore < 0.5 && healthScore > 0) {
				rateLimitedCount += 1;
			}
			attempts.push(route);
		}
	}

	return { attempts, earliestRetryAfterMs, skippedByCircuit, rateLimitedCount };
}
