/**
 * Provider 熔断（单键化后按 `providers.id` 维度）。
 *
 * 按失败类别区分冷却策略：
 * - `rate_limit`（上游 429）：优先用上游 `Retry-After`（封顶 15min）；无头时按冷却周期递增退避
 *   （5s → 15s → 30s → 60s 封顶）；同一限流回合内熔断已打开时不再累加计数；一次成功即清零。
 * - `auth`（401/403）：5min（key 大概率失效，等待人工处理；配合告警日志）。
 * - `server`（普通 5xx）：连续 3 次失败后短熔断 10s；524 / fetch 不写入此类熔断。
 *
 * 熔断中的 provider 一律跳过；全部不可用时由 dispatch 层返回 429 + Retry-After。
 * 状态为单实例进程内存。
 */

export type ProviderFailureKind = 'rate_limit' | 'auth' | 'server';

export type ProviderCircuitFailureResult = {
	failureKind: ProviderFailureKind;
	openUntil: number;
	cooldownMs: number;
	/** 本次失败是否打开或延长了熔断窗口 */
	openedOrExtended: boolean;
};

const RATE_LIMIT_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000] as const;
const RATE_LIMIT_RETRY_AFTER_CAP_MS = 900_000;
const AUTH_COOLDOWN_MS = 300_000;
const SERVER_FAILURE_THRESHOLD = 3;
const SERVER_COOLDOWN_MS = 10_000;
const MAX_ENTRIES = 10_000;

type CircuitEntry = {
	openUntil: number;
	consecutiveRateLimit: number;
	consecutiveServerFailures: number;
};

const circuitByProvider = new Map<string, CircuitEntry>();

// ─── Per-key 熔断：与 provider 级熔断正交，避免单 key 故障污染整个 provider ───
type KeyCircuitEntry = {
	openUntil: number;
	failureCount: number;
	lastFailureKind: ProviderFailureKind | null;
};

const circuitByKey = new Map<string, KeyCircuitEntry>();
const KEY_CIRCUIT_THRESHOLD = 2; // 单 key 连续 2 次失败即熔断
const KEY_CIRCUIT_COOLDOWN_MS = 30_000; // key 级默认冷却 30s

function purgeKeyCircuitIfOverCapacity(now: number): void {
	if (circuitByKey.size <= MAX_ENTRIES) return;
	for (const [keyId, entry] of circuitByKey) {
		if (entry.openUntil <= now) {
			circuitByKey.delete(keyId);
		}
	}
}

function purgeIfOverCapacity(now: number): void {
	if (circuitByProvider.size <= MAX_ENTRIES) return;
	for (const [providerId, entry] of circuitByProvider) {
		if (entry.openUntil <= now && entry.consecutiveRateLimit === 0 && entry.consecutiveServerFailures === 0) {
			circuitByProvider.delete(providerId);
		}
	}
}

/**
 * 解析上游 `Retry-After` 头（秒数或 HTTP date）为毫秒；非法时 null。
 */
export function parseRetryAfterMs(retryAfterHeader: string | null | undefined, now = Date.now()): number | null {
	if (!retryAfterHeader) return null;
	const trimmed = retryAfterHeader.trim();
	if (/^\d+$/.test(trimmed)) {
		const seconds = Number(trimmed);
		return seconds >= 0 ? seconds * 1000 : null;
	}
	const dateMs = Date.parse(trimmed);
	if (!Number.isNaN(dateMs)) {
		return Math.max(0, dateMs - now);
	}
	return null;
}

/**
 * 记录一次失败并打开熔断。
 * @param retryAfterMs 上游建议的恢复时间（仅 `rate_limit` 生效；来自 `parseRetryAfterMs`）
 */
export function markProviderFailure(
	providerId: string,
	kind: ProviderFailureKind,
	retryAfterMs?: number | null,
	now = Date.now()
): ProviderCircuitFailureResult {
	const entry = circuitByProvider.get(providerId) ?? {
		openUntil: 0,
		consecutiveRateLimit: 0,
		consecutiveServerFailures: 0,
	};
	const previousOpenUntil = entry.openUntil;
	let appliedCooldownMs = 0;

	if (kind === 'rate_limit') {
		let cooldownMs: number;
		if (retryAfterMs != null && retryAfterMs > 0) {
			cooldownMs = Math.min(retryAfterMs, RATE_LIMIT_RETRY_AFTER_CAP_MS);
		} else {
			// 熔断已打开 = 同一限流回合的并发/连续 429，不重复升级
			if (entry.openUntil <= now) {
				entry.consecutiveRateLimit += 1;
			}
			const idx = Math.min(entry.consecutiveRateLimit - 1, RATE_LIMIT_BACKOFF_MS.length - 1);
			cooldownMs = RATE_LIMIT_BACKOFF_MS[idx]!;
		}
		appliedCooldownMs = cooldownMs;
		entry.openUntil = Math.max(entry.openUntil, now + cooldownMs);
	} else if (kind === 'auth') {
		appliedCooldownMs = AUTH_COOLDOWN_MS;
		entry.openUntil = Math.max(entry.openUntil, now + AUTH_COOLDOWN_MS);
	} else {
		const wasOpen = entry.openUntil > now;
		if (!wasOpen && entry.consecutiveServerFailures >= SERVER_FAILURE_THRESHOLD) {
			entry.consecutiveServerFailures = 0;
		}
		if (entry.openUntil <= now) {
			entry.consecutiveServerFailures += 1;
		}
		if (entry.consecutiveServerFailures >= SERVER_FAILURE_THRESHOLD) {
			appliedCooldownMs = SERVER_COOLDOWN_MS;
			entry.openUntil = Math.max(entry.openUntil, now + SERVER_COOLDOWN_MS);
		}
	}
	circuitByProvider.set(providerId, entry);
	purgeIfOverCapacity(now);

	const openedOrExtended = entry.openUntil > Math.max(previousOpenUntil, now);
	const cooldownMs = entry.openUntil > now ? Math.max(0, entry.openUntil - now) : appliedCooldownMs;

	return {
		failureKind: kind,
		openUntil: entry.openUntil,
		cooldownMs,
		openedOrExtended,
	};
}

/** 请求成功：清零连续失败计数（已过期的 openUntil 一并清理）。 */
export function markProviderSuccess(providerId: string, now = Date.now()): void {
	const entry = circuitByProvider.get(providerId);
	if (!entry) return;
	if (entry.openUntil <= now) {
		circuitByProvider.delete(providerId);
	} else {
		entry.consecutiveRateLimit = 0;
		entry.consecutiveServerFailures = 0;
	}
}

/** 熔断剩余毫秒数；未熔断返回 0。 */
export function getProviderCircuitRemainingMs(providerId: string, now = Date.now()): number {
	const entry = circuitByProvider.get(providerId);
	if (!entry) return 0;
	return Math.max(0, entry.openUntil - now);
}

export function isProviderCircuitOpen(providerId: string, now = Date.now()): boolean {
	return getProviderCircuitRemainingMs(providerId, now) > 0;
}

/** 测试用：清空熔断状态。 */
export function resetProviderCircuitStateForTests(): void {
	circuitByProvider.clear();
}

// ─── Per-key 熔断 API ────────────────────────────────────────────────────────
// 单 key 失败只影响该 key，不波及 provider 上其他 key（参考 freellmapi hasOtherUsableKey 思路）。

/** 记录某 key 的失败并打开熔断。 */
export function markKeyFailure(
	keyFingerprint: string,
	kind: ProviderFailureKind,
	now = Date.now()
): void {
	if (!keyFingerprint) return;
	const entry = circuitByKey.get(keyFingerprint) ?? {
		openUntil: 0,
		failureCount: 0,
		lastFailureKind: null,
	};
	const previousOpenUntil = entry.openUntil;

	// auth 类直接 30s；rate_limit 按梯度；server 按阈值
	let cooldownMs = KEY_CIRCUIT_COOLDOWN_MS;
	if (kind === 'auth') {
		cooldownMs = AUTH_COOLDOWN_MS;
	} else if (kind === 'rate_limit') {
		const backoffIdx = Math.min(entry.failureCount, RATE_LIMIT_BACKOFF_MS.length - 1);
		cooldownMs = RATE_LIMIT_BACKOFF_MS[backoffIdx]!;
	}
	// server：累计到阈值才打开
	if (kind === 'server' && entry.failureCount < KEY_CIRCUIT_THRESHOLD - 1) {
		entry.failureCount += 1;
		entry.lastFailureKind = kind;
		circuitByKey.set(keyFingerprint, entry);
		purgeKeyCircuitIfOverCapacity(now);
		return;
	}

	entry.openUntil = Math.max(entry.openUntil, now + cooldownMs);
	entry.failureCount = kind === 'server' ? entry.failureCount + 1 : 1;
	entry.lastFailureKind = kind;
	circuitByKey.set(keyFingerprint, entry);
	purgeKeyCircuitIfOverCapacity(now);

	const openedOrExtended = entry.openUntil > Math.max(previousOpenUntil, now);
	if (openedOrExtended) {
		console.warn(
			`[Gateway Proxy] key-level circuit opened fingerprint=${keyFingerprint} kind=${kind} cooldown=${cooldownMs}ms`
		);
	}
}

/** 请求成功：清零该 key 的熔断。 */
export function markKeySuccess(keyFingerprint: string, now = Date.now()): void {
	if (!keyFingerprint) return;
	const entry = circuitByKey.get(keyFingerprint);
	if (!entry) return;
	if (entry.openUntil <= now) {
		circuitByKey.delete(keyFingerprint);
	} else {
		entry.failureCount = 0;
		entry.openUntil = now; // 提前解锁
		circuitByKey.set(keyFingerprint, entry);
	}
}

/** 该 key 是否仍在熔断中。 */
export function getKeyCircuitRemainingMs(keyFingerprint: string, now = Date.now()): number {
	const entry = circuitByKey.get(keyFingerprint);
	if (!entry) return 0;
	return Math.max(0, entry.openUntil - now);
}

/** 测试用：清空 key 级熔断状态。 */
export function resetKeyCircuitStateForTests(): void {
	circuitByKey.clear();
}
