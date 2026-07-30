/**
 * 全局路由策略：`system_config.ROUTE_STRATEGY`。
 * 进程内缓存 30s；非法值回退 {@link DEFAULT_ROUTE_STRATEGY}。
 */

import type { RouteStrategyName } from '../types';
import { DEFAULT_ROUTE_STRATEGY, isRouteStrategyName } from '../db/model-route-policy';
import type { GatewayRepositories } from '../storage/repositories-types';

export const ROUTE_STRATEGY_KEY = 'ROUTE_STRATEGY';
export const ROUTE_STRATEGY_CACHE_TTL_MS = 30_000;

type CacheEntry = {
	value: RouteStrategyName;
	expiresAt: number;
};

let cache: CacheEntry | null = null;

export function resetRouteStrategyCacheForTests(): void {
	cache = null;
}

function normalizeRouteStrategy(raw: string | null | undefined): RouteStrategyName {
	const s = (raw ?? '').trim().toLowerCase();
	return isRouteStrategyName(s) ? s : DEFAULT_ROUTE_STRATEGY;
}

/**
 * 读取全局路由策略（带进程内存缓存）。
 */
export async function getGlobalRouteStrategy(repos: GatewayRepositories): Promise<RouteStrategyName> {
	const now = Date.now();
	if (cache && cache.expiresAt > now) {
		return cache.value;
	}
	const raw = await repos.systemConfig.getConfig(ROUTE_STRATEGY_KEY);
	const value = normalizeRouteStrategy(raw);
	cache = { value, expiresAt: now + ROUTE_STRATEGY_CACHE_TTL_MS };
	return value;
}
