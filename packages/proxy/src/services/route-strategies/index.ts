/**
 * 同 priority 层内的路由排序策略。
 */
import type { GatewayRepositories, RouteStrategyName, UpstreamProtocol } from '@octafuse/core';
import {
	DEFAULT_ROUTE_STRATEGY,
	getGlobalRouteStrategy,
	isRouteStrategyName,
	resolveModelRoutePolicyStrategy,
} from '@octafuse/core';
import type { RouteOrderStrategy } from './types';
import { orderByAffinity } from './affinity';
import { orderByWeightedRandom } from './weighted-random';
import { orderByStrict } from './strict';
import { orderByRoundRobin } from './round-robin';

export type { RouteOrderContext, RouteOrderStrategy } from './types';

export const ROUTE_STRATEGIES: Record<RouteStrategyName, RouteOrderStrategy> = {
	affinity: orderByAffinity,
	weighted_random: orderByWeightedRandom,
	strict: orderByStrict,
	round_robin: orderByRoundRobin,
};

/**
 * 六级解析：pool → model capability rule → protocol rule → model strategy → global system_config → DEFAULT。
 */
export async function resolveRouteStrategy(params: {
	routePolicyRaw: string | null | undefined;
	poolStrategy?: string | null;
	protocol: UpstreamProtocol | string;
	capability: string;
	routeGroup: string;
	repos: GatewayRepositories;
}): Promise<RouteStrategyName> {
	if (params.poolStrategy && isRouteStrategyName(params.poolStrategy)) {
		return params.poolStrategy;
	}
	const fromModel = resolveModelRoutePolicyStrategy(
		params.routePolicyRaw,
		params.protocol,
		params.capability,
		params.routeGroup
	);
	if (fromModel) return fromModel;
	return getGlobalRouteStrategy(params.repos);
}

/** affinityKey = userId|baseModelId|routeGroup|protocol */
export function buildAffinityKey(
	userId: string,
	baseModelId: string,
	routeGroup: string,
	protocol: string
): string {
	return `${userId}|${baseModelId}|${routeGroup}|${protocol}`;
}

/** tierKey 前缀 = baseModelId|routeGroup|protocol；完整 tierKey = `${prefix}|${priority}` */
export function buildTierKeyPrefix(baseModelId: string, routeGroup: string, protocol: string): string {
	return `${baseModelId}|${routeGroup}|${protocol}`;
}

export { resetRoundRobinStateForTests } from './round-robin';
export { fnv1a32, routeAffinityScore } from './route-affinity-hash';
export { DEFAULT_ROUTE_STRATEGY };
