import type { RouteResult } from '../model-router';

export type RouteOrderContext = {
	/** userId|baseModelId|routeGroup|protocol — 不含 capability */
	affinityKey: string;
	/** baseModelId|routeGroup|protocol|priority — RR 用 */
	tierKey: string;
};

export type RouteOrderStrategy = (routes: RouteResult[], ctx: RouteOrderContext) => RouteResult[];
