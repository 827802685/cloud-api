/**
 * 路由稳定性跟踪（进程内存，滑动窗口）。
 *
 * 用途：为模型路由权重提供「稳定性评分」支撑。评分综合：
 * - 成功率（滑动窗口，默认最近 48 次）
 * - 连续失败惩罚（每连续失败一次额外扣分）
 * - 失败类型权重（超时 = 更严重，HTTP 错误次之）
 *
 * 与 Provider 熔断器（`provider-circuit-breaker`）不同：
 * - 熔断器针对 provider 的瞬时冷却（rate_limit / auth / server）
 * - 本模块针对 route 的中长期稳定性评分，用于权重动态调整
 *
 * 同一 Worker 进程内，Proxy 正式请求与 Playground 测试请求共享此状态，
 * 因此测试台的超时/报错也会计入稳定性（前后端合并后天然共享）。
 */
const MAX_RESULTS_PER_ROUTE = 48;
/** 超过该时长无更新的路由视为无数据，返回默认稳定分 1 */
const STALE_AGE_MS = 6 * 60 * 60 * 1000; // 6 小时
/** 评分所需的最小样本数，不足则不做惩罚（避免误伤冷启动模型） */
const MIN_SAMPLES_FOR_PENALTY = 4;

/** 失败类型：超时（timeout）比普通错误（error）更严重 */
export type RouteFailureKind = 'error' | 'timeout';

type RouteStabilityEntry = {
	/** 近 N 次结果，true=成功，false=失败 */
	results: boolean[];
	/** 连续失败次数（用于额外惩罚） */
	consecutiveFailures: number;
	/** 最近一次更新时间 */
	lastUpdatedAt: number;
};

const stabilityByRoute = new Map<string, RouteStabilityEntry>();

/** 单次失败权重：timeout 计 1，error 计 0.8（超时更严重） */
const FAILURE_WEIGHT: Record<RouteFailureKind, number> = {
	timeout: 1,
	error: 0.8,
};

function entryFor(routeId: string): RouteStabilityEntry {
	let entry = stabilityByRoute.get(routeId);
	if (!entry) {
		entry = { results: [], consecutiveFailures: 0, lastUpdatedAt: Date.now() };
		stabilityByRoute.set(routeId, entry);
	}
	return entry;
}

/** 记录一次路由调用成功。 */
export function recordRouteStabilitySuccess(routeId: string, now = Date.now()): void {
	if (!routeId) return;
	const entry = entryFor(routeId);
	entry.results.push(true);
	if (entry.results.length > MAX_RESULTS_PER_ROUTE) {
		entry.results.shift();
	}
	entry.consecutiveFailures = 0;
	entry.lastUpdatedAt = now;
}

/** 记录一次路由调用失败。`kind` 区分超时与普通错误。 */
export function recordRouteStabilityFailure(
	routeId: string,
	kind: RouteFailureKind = 'error',
	now = Date.now()
): void {
	if (!routeId) return;
	const entry = entryFor(routeId);
	// 失败可计多次权重（timeout 计 1，error 计 0.8），用布尔数组近似表达
	const weight = FAILURE_WEIGHT[kind] ?? FAILURE_WEIGHT.error;
	entry.results.push(false);
	// 若权重 >1 额外补一次失败样本（timeout 更严重）
	if (weight > 1) {
		entry.results.push(false);
	}
	while (entry.results.length > MAX_RESULTS_PER_ROUTE) {
		entry.results.shift();
	}
	entry.consecutiveFailures += 1;
	entry.lastUpdatedAt = now;
}

/**
 * 获取路由稳定性评分（0-1，1 为最稳定）。
 * - 无数据 / 数据过期 / 样本不足 → 返回 1（不惩罚，避免误伤冷启动）
 * - 成功率越低，评分越低
 * - 连续失败额外惩罚：每连续失败一次扣 0.08，最多扣 0.4
 */
export function getRouteStabilityScore(routeId: string, now = Date.now()): number {
	if (!routeId) return 1;
	const entry = stabilityByRoute.get(routeId);
	if (!entry || entry.results.length === 0) return 1;

	// 过期数据视为无数据
	if (now - entry.lastUpdatedAt > STALE_AGE_MS) return 1;

	const total = entry.results.length;
	// 样本不足，不做惩罚
	if (total < MIN_SAMPLES_FOR_PENALTY) return 1;

	const successes = entry.results.filter((r) => r).length;
	const successRate = successes / total;

	let score = successRate;

	// 连续失败惩罚
	if (entry.consecutiveFailures > 0) {
		const consecutivePenalty = Math.min(entry.consecutiveFailures * 0.08, 0.4);
		score = Math.max(0, score - consecutivePenalty);
	}

	return Math.max(0, Math.min(1, score));
}

/**
 * 计算路由的有效权重：`baseWeight × stabilityScore`。
 * 返回至少 1（保证可用），向上取整。
 */
export function effectiveRouteWeight(
	routeId: string,
	baseWeight: number,
	now = Date.now()
): number {
	const stability = getRouteStabilityScore(routeId, now);
	const multiplied = Math.max(1, baseWeight) * stability;
	return Math.max(1, Math.round(multiplied));
}

/** 仅测试用：清空稳定性状态。 */
export function resetRouteStabilityStateForTests(): void {
	stabilityByRoute.clear();
}