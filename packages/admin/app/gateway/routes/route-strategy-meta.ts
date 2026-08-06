import type { RouteStrategyName } from '@octafuse/core';
import { ROUTE_STRATEGY_NAMES } from '@octafuse/core/db/model-route-policy';

export type RouteStrategyDiagramKind = RouteStrategyName;

export type RouteStrategyMeta = {
	id: RouteStrategyName;
	/** Shown as a secondary monospace badge; never localized. */
	machineId: RouteStrategyName;
	recommended: boolean;
	/** Soft warning for CF Workers / multi-isolate deployments. */
	instanceLocal: boolean;
	diagram: RouteStrategyDiagramKind;
};

const META_BY_ID: Record<RouteStrategyName, RouteStrategyMeta> = {
	affinity: {
		id: 'affinity',
		machineId: 'affinity',
		recommended: true,
		instanceLocal: false,
		diagram: 'affinity',
	},
	strict: {
		id: 'strict',
		machineId: 'strict',
		recommended: false,
		instanceLocal: false,
		diagram: 'strict',
	},
	weighted_random: {
		id: 'weighted_random',
		machineId: 'weighted_random',
		recommended: false,
		instanceLocal: false,
		diagram: 'weighted_random',
	},
	round_robin: {
		id: 'round_robin',
		machineId: 'round_robin',
		recommended: false,
		instanceLocal: true,
		diagram: 'round_robin',
	},
};

/**
 * Admin UI card order (deterministic first, then load-balance).
 * Persisted enum order remains `ROUTE_STRATEGY_NAMES` in core.
 */
export const ROUTE_STRATEGY_UI_ORDER = [
	'affinity',
	'strict',
	'weighted_random',
	'round_robin',
] as const satisfies readonly RouteStrategyName[];

export const ROUTE_STRATEGY_META_LIST: RouteStrategyMeta[] = ROUTE_STRATEGY_UI_ORDER.map(
	(id) => META_BY_ID[id]
);

export function getRouteStrategyMeta(id: string): RouteStrategyMeta | null {
	if (!ROUTE_STRATEGY_NAMES.includes(id as RouteStrategyName)) return null;
	return META_BY_ID[id as RouteStrategyName];
}

/** Demo targets used by the SVG mini diagrams (not real providers). */
export const STRATEGY_DIAGRAM_TARGETS = [
	{ id: 't1', label: 'T1', weightPct: 60, order: 1 },
	{ id: 't2', label: 'T2', weightPct: 30, order: 2 },
	{ id: 't3', label: 'T3', weightPct: 10, order: 3 },
] as const;
