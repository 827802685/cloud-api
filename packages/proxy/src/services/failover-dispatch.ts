/**
 * 上游调度与故障转移：
 * - 可选 Provider sticky（跨 Tier 优先）→ priority 硬序 + 层内 route strategy 编排尝试序列。
 * - 失败按类别进入 provider 熔断（`provider-circuit-breaker`：429 无头 5s→60s 梯度；普通 5xx 连续 3 次后 10s；524/fetch 不跨请求熔断）。
 * - 全部候选因熔断不可用时返回 429 + Retry-After（而非 502）。
 * - 循环内复查：本次请求内刚被熔断的 provider（同 providerId 多 target）不再打。
 */
import type { GatewayRepositories, RouteStrategyName, UpstreamProtocol } from '@cloud-api/core';
import { DEFAULT_ROUTE_STRATEGY, fingerprintProviderApiKey } from '@cloud-api/core';
import type { RoutePoolStickyRoutingConfig } from '@cloud-api/core/db/route-pool-sticky-types';
import type { RouteResult } from './model-router';
import type { UsageFromStream } from './proxy';
import { EMPTY_USAGE } from './proxy';
import { buildRouteAttemptPlan } from './route-attempt-planner';
import {
	recordRouteStabilityFailure,
	recordRouteStabilitySuccess,
} from './route-stability-tracker';
import {
	recordBanditSuccess,
	recordBanditFailure,
} from './auto-model-bandit';
import {
	getProviderCircuitRemainingMs,
	markProviderFailure,
	markProviderSuccess,
	parseRetryAfterMs,
	getKeyCircuitRemainingMs,
	markKeyFailure,
	markKeySuccess,
} from './provider-circuit-breaker';
import type { GatewayCircuitAlertEvent } from './circuit-alert-types';
import {
	classifyUpstreamFetchFailure,
	classifyUpstreamHttpFailure,
	type UpstreamFailureClassification,
} from './upstream-failure-classifier';
import type { RequestTimingAttempt, RequestTimingCollector } from './request-timing';
import { GatewayErrorCode } from './gateway-error-codes';
import { gatewayErrorResponse, gatewayNestedErrorResponse } from './gateway-error-response';
import {
	clearStickyBindingSync,
	mergeStickyIntoAttempts,
	resolveStickySession,
	resolveStickyTrace,
	scheduleStickyBind,
	scheduleStickyTouchIfNeeded,
	shouldInvalidateStickyBinding,
	stickyMutationPromise,
	type StickySession,
	type StickyTraceSnapshot,
} from './provider-sticky-routing';
import { recordProviderRequest, recordRateLimitEvent, recordProviderSuccess } from './provider-rate-tracker';

/** Opportunistic hygiene: ~1/500 sticky-enabled requests purge expired rows. */
const STICKY_STALE_GC_PROBABILITY = 1 / 500;
const STICKY_STALE_GC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const STICKY_STALE_GC_LIMIT = 500;

function maybeScheduleStickyStaleGc(
	repos: GatewayRepositories,
	session: StickySession,
	nowMs = Date.now()
): void {
	if (Math.random() >= STICKY_STALE_GC_PROBABILITY) return;
	const cutoffIso = new Date(nowMs - STICKY_STALE_GC_MAX_AGE_MS).toISOString();
	session.mutations.push(
		repos.routePoolSticky.deleteStaleBefore(cutoffIso, STICKY_STALE_GC_LIMIT).catch((err) => {
			console.warn('[Gateway Sticky] stale GC failed', err);
		})
	);
}

/** Images 合成 abort（Gateway 超时 / 客户端取消）——禁止 failover 再打上游。 */
export type ImageDispatchAbortReason = 'client_abort' | 'gateway_timeout';

/** 协议 driver 可选透传（如 Images / Audio 已解析的 body / usage，避免 route 侧重复 parse）。 */
export type ProxyDispatchMeta = {
	imageUsage?: import('@cloud-api/core').ImageTokenUsage | null;
	parsedBody?: unknown;
	/** 仅 Images：上游 wait 被 abort 时由 driver 写入（见 openai-images-driver） */
	imageAbortReason?: ImageDispatchAbortReason;
	/** 仅 Audio transcriptions：计费时长（秒） */
	audioDurationSeconds?: number | null;
	/** 仅 Audio：duration 来源 */
	audioDurationSource?: 'upstream' | 'media' | 'client' | 'estimated' | null;
	/** 仅 Audio：上传文件字节数 */
	audioFileBytes?: number;
	/** 仅 Audio token 计费：上游 `usage.type=tokens` */
	audioTokenUsage?: import('@cloud-api/core').AudioTokenUsage | null;
};

/** Images abort 的 504 不得换 provider / 换路由（避免客户端取消或超时后二次打 OpenAI）。 */
export function shouldFailImmediatelyForImageAbort(meta?: ProxyDispatchMeta | null): boolean {
	const reason = meta?.imageAbortReason;
	return reason === 'client_abort' || reason === 'gateway_timeout';
}

export type ProxyDispatchResult = {
	response: Response;
	usagePromise: Promise<UsageFromStream>;
	upstreamRequestId: string | null;
	meta?: ProxyDispatchMeta;
};

export type ProxyFailoverResult = {
	response: Response;
	usagePromise: Promise<UsageFromStream>;
	upstreamRequestId: string | null;
	chosenRoute: RouteResult;
	/** 本次请求触发的 provider 熔断事件（仅 openedOrExtended） */
	circuitEvents: GatewayCircuitAlertEvent[];
	/** 因已有 provider 熔断短路、无需重复 webhook 告警 */
	suppressErrorAlert: boolean;
	meta?: ProxyDispatchMeta;
	/**
	 * Lazy sticky observation for `route_trace`.
	 * Await inside request-log background work so CAS outcomes are visible.
	 */
	stickyTrace?: (() => Promise<StickyTraceSnapshot>) | undefined;
	/** Background bind/touch mutations (schedule via waitUntil) */
	stickyMutationPromise?: Promise<unknown> | null;
	/** 本次请求总共尝试了多少个 provider（含成功的那个） */
	attemptCount: number;
};

export type FailoverDispatchOptions = {
	affinityKey: string;
	tierKeyPrefix: string;
	strategy: RouteStrategyName;
	/** Per-priority overrides from `route_pools.tier_strategies` */
	tierStrategies?: ReadonlyMap<number, RouteStrategyName> | null;
	timing?: RequestTimingCollector | null;
	/** Route pool id for sticky bindings (null disables sticky) */
	routePoolId?: string | null;
	/** Pool sticky config from surface join */
	sticky?: RoutePoolStickyRoutingConfig | null;
	/**
	 * 整个 failover 过程的墙钟重试预算（毫秒）。
	 * 超过此预算后不再发起新的上游请求（attempt 0 和 1 不受限制，保证首次尝试正常执行）。
	 * 设置为 null 或 0 时不启用预算限制。
	 */
	retryBudgetMs?: number | null;
	/**
	 * Hedge timeout：单 attempts 首次响应到达前的最大等待时间（毫秒）。
	 * 若超时未收到首字节，则 abort 当前 in-flight 请求并切换到下一个 provider。
	 * 仅在流式响应且 timing 可用时生效。
	 * 设置为 null 或 0 时不启用 hedging。
	 */
	hedgeTimeoutMs?: number | null;
};

type DispatchFn = (
	route: RouteResult,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt
) => Promise<ProxyDispatchResult>;

function emptyRoute(protocol: UpstreamProtocol): RouteResult {
	return {
		targetId: '',
		modelSurfaceId: null,
		routePoolId: '',
		providerId: '',
		providerName: '',
		providerModelName: '',
		upstreamProtocol: protocol,
		upstreamOperation: '*',
		adapter: 'passthrough',
		providerEndpoints: {},
		providerApiKey: '',
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: null,
		routeGroup: 'default',
		routePriority: 0,
		routeWeight: 1,
		providerKeyId: null,
		providerKeyLabel: null,
		providerKeyFingerprint: null,
	};
}

/**
 * 合并多个 AbortSignal：任一触发即 abort；无有效 signal 返回 undefined。
 * 用于同时响应「客户端取消」（requestSignal）与「hedge 超时」（hedgeSignal），
 * 避免 hedge 启用时丢失客户端取消信号。
 */
function mergeSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
	const valid = signals.filter((s): s is AbortSignal => Boolean(s));
	if (valid.length === 0) return undefined;
	if (valid.length === 1) return valid[0];
	const controller = new AbortController();
	for (const s of valid) {
		if (s.aborted) {
			controller.abort();
			return controller.signal;
		}
		s.addEventListener('abort', () => controller.abort(), { once: true });
	}
	return controller.signal;
}

function logProviderSwitchAlert(route: RouteResult, classification: UpstreamFailureClassification, status?: number): void {
	if (!classification.alertOnKeySwitch) return;
	console.warn(
		`[Gateway Proxy] provider auth issue, trying next provider providerId=${route.providerId} status=${status ?? 'fetch_error'}`
	);
}

function allProvidersBusyDueToCircuitOnly(plan: {
	attempts: { length: number };
	skippedByCircuit: number;
}): boolean {
	return plan.attempts.length === 0 && plan.skippedByCircuit > 0;
}

function allProvidersBusyResponse(retryAfterMs: number | null): Response {
	const retryAfterSeconds = Math.max(1, Math.ceil((retryAfterMs ?? 30_000) / 1000));
	const code = GatewayErrorCode.circuitUpstreamCapacityExhausted;
	return gatewayNestedErrorResponse({
		status: 429,
		code,
		error: {
			message: `All upstream providers are cooling down. Please retry after ${retryAfterSeconds} seconds.`,
			type: 'upstream_capacity_exhausted',
			retry_after_seconds: retryAfterSeconds,
		},
		headers: { 'Retry-After': String(retryAfterSeconds) },
	});
}

/**
 * 按「可选 sticky → provider priority 层 → route strategy」调度上游请求。
 */
export async function failoverDispatch(
	repos: GatewayRepositories,
	routes: RouteResult[],
	expectedProtocol: UpstreamProtocol,
	dispatch: DispatchFn,
	requestSignal?: AbortSignal,
	options?: FailoverDispatchOptions
): Promise<ProxyFailoverResult> {
	const timing = options?.timing ?? null;
	timing?.markUpstreamDispatchStart();
	const protocolRoutes = routes.filter((route) => {
		if (route.upstreamProtocol === expectedProtocol) return true;
		console.warn(
			`[Gateway Proxy] unsupported protocol, skipping providerId=${route.providerId} protocol=${route.upstreamProtocol}`
		);
		return false;
	});

	if (protocolRoutes.length === 0) {
		return {
			response: gatewayErrorResponse({
				status: 502,
				code: GatewayErrorCode.noRoute,
				message: 'No routes configured',
			}),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			chosenRoute: emptyRoute(expectedProtocol),
			circuitEvents: [],
			suppressErrorAlert: false,
			attemptCount: 0,
		};
	}

	const affinityKey = options?.affinityKey ?? '';
	const tierKeyPrefix = options?.tierKeyPrefix ?? '';
	const strategy: RouteStrategyName = options?.strategy ?? DEFAULT_ROUTE_STRATEGY;
	const tierStrategies = options?.tierStrategies ?? null;
	const stickyConfig = options?.sticky ?? null;
	const routePoolId =
		options?.routePoolId ?? protocolRoutes.find((r) => r.routePoolId)?.routePoolId ?? null;

	// 统一时间戳：粘性会话解析与尝试计划共享同一 nowMs，
	// 避免两者各自取 Date.now() 导致绑定有效期/熔断判断漂移（竞态）。
	const nowMs = Date.now();

	const { session: stickySession, stickyRoute } = stickyConfig?.enabled
		? await resolveStickySession(repos, {
				routePoolId,
				affinityKey,
				config: stickyConfig,
				candidates: protocolRoutes,
				nowMs,
			})
		: { session: null, stickyRoute: null };

	if (stickySession) {
		maybeScheduleStickyStaleGc(repos, stickySession);
	}

	const circuitEvents: GatewayCircuitAlertEvent[] = [];
	const plan = buildRouteAttemptPlan(
		protocolRoutes,
		{ affinityKey, tierKeyPrefix },
		strategy,
		nowMs,
		tierStrategies
	);
	const attempts = mergeStickyIntoAttempts(plan.attempts, stickyRoute);

	if (attempts.length === 0) {
		return {
			response: allProvidersBusyResponse(plan.earliestRetryAfterMs),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			chosenRoute: protocolRoutes[0]!,
			circuitEvents: [],
			suppressErrorAlert: allProvidersBusyDueToCircuitOnly(plan),
			attemptCount: 0,
			stickyTrace: () => resolveStickyTrace(stickySession),
			stickyMutationPromise: stickyMutationPromise(stickySession),
		};
	}

	// 墙钟重试预算：记录 dispatch 开始的绝对时间，用于后续判断是否耗尽预算
	const dispatchStartMs = Date.now();
	const retryBudgetMs = options?.retryBudgetMs ?? null;
	const hedgeTimeoutMs = options?.hedgeTimeoutMs ?? null;

	let lastResponse: Response | null = null;
	let lastRoute: RouteResult = protocolRoutes[0]!;
	let lastTimingAttempt: RequestTimingAttempt | undefined;
	let stickyAttemptCleared = false;
	let attemptCount = 0;

	/** finish() 的输入类型：不含 attemptCount/stickyTrace/stickyMutationPromise（由 finish 补充） */
	type FinishInput = Omit<ProxyFailoverResult, 'attemptCount' | 'stickyTrace' | 'stickyMutationPromise'>;

	const finish = (result: FinishInput): ProxyFailoverResult => ({
		...result,
		attemptCount,
		stickyTrace: () => resolveStickyTrace(stickySession),
		stickyMutationPromise: stickyMutationPromise(stickySession),
	});

	for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
		const route = attempts[attemptIndex]!;
		const isStickyAttempt =
			Boolean(stickyRoute) && route.targetId === stickyRoute!.targetId && attemptIndex === 0;

		if (getProviderCircuitRemainingMs(route.providerId) > 0) {
			console.warn(
				`[Gateway Proxy] provider cooling down mid-request, skipping providerId=${route.providerId}`
			);
			continue;
		}

		// Per-key 熔断：单 key 失败只影响该 key，不波及整个 provider
		if (route.providerKeyFingerprint) {
			const keyCircuitRemaining = getKeyCircuitRemainingMs(route.providerKeyFingerprint);
			if (keyCircuitRemaining > 0) {
				console.warn(
					`[Gateway Proxy] key cooling down mid-request, skipping fingerprint=${route.providerKeyFingerprint} remaining=${keyCircuitRemaining}ms providerId=${route.providerId}`
				);
				continue;
			}
		}

		// 墙钟重试预算检查：attempt 0 和 1 不受限制（保证首次尝试正常执行）
		if (retryBudgetMs != null && retryBudgetMs > 0 && attemptIndex >= 2) {
			const elapsed = Date.now() - dispatchStartMs;
			if (elapsed >= retryBudgetMs) {
				console.warn(
					`[Gateway Proxy] retry budget exhausted elapsed=${elapsed}ms budget=${retryBudgetMs}ms attempt=${attemptCount + 1}, stopping failover`
				);
				break;
			}
		}

		attemptCount += 1;
		const timingAttempt = timing?.startAttempt(route);
		lastTimingAttempt = timingAttempt;
		const hasNextAttempt = attemptIndex < attempts.length - 1;
		console.log(
			`[Gateway Proxy] calling provider providerId=${route.providerId} model=${route.providerModelName}${isStickyAttempt ? ' sticky=1' : ''} attempt=${attemptCount}`
		);

		// Hedge timeout：若启用且在首字节到达前超过阈值，则 abort 当前请求并切换 provider
		let hedgeSignal: AbortSignal | undefined;
		let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
		if (hedgeTimeoutMs != null && hedgeTimeoutMs > 0 && timing != null) {
			const hedgeController = new AbortController();
			hedgeSignal = hedgeController.signal;
			hedgeTimer = setTimeout(() => {
				if (!hedgeController.signal.aborted) {
					console.warn(
						`[Gateway Proxy] hedge timeout trigger providerId=${route.providerId} timeout=${hedgeTimeoutMs}ms attempt=${attemptCount}`
					);
					hedgeController.abort();
				}
			}, hedgeTimeoutMs);
		}

		let response: Response;
		let usagePromise: Promise<UsageFromStream>;
		let upstreamRequestId: string | null = null;
		let dispatchMeta: ProxyDispatchMeta | undefined;
		try {
			// 合并客户端取消 + hedge 超时信号：任一触发都会中断上游 fetch（driver 已透传 signal）
			const effectiveSignal = mergeSignals(requestSignal, hedgeSignal);
			const dispatched = await dispatch(route, effectiveSignal, timing, timingAttempt);
			response = dispatched.response;
			usagePromise = dispatched.usagePromise;
			upstreamRequestId = dispatched.upstreamRequestId;
			dispatchMeta = dispatched.meta;
		} catch (err) {
			// 客户端取消：立即停止 failover，不再尝试下一个 provider
			if (requestSignal?.aborted) {
				throw err;
			}
			// hedge abort 被触发时 throw 的 DOMException 不属于需要告警的 fetch 错误
			const isHedgeAbort =
				hedgeSignal?.aborted === true &&
				err instanceof DOMException &&
				err.name === 'AbortError';
			if (hedgeTimer) {
				clearTimeout(hedgeTimer);
				hedgeTimer = undefined;
			}
			if (isHedgeAbort) {
				console.warn(
					`[Gateway Proxy] hedge aborted providerId=${route.providerId} attempt=${attemptCount}, trying next`
				);
				if (hasNextAttempt) timing?.markAttemptFailover(timingAttempt);
				continue;
			}
			timing?.markAttemptError(timingAttempt, err);
			if (hasNextAttempt) timing?.markAttemptFailover(timingAttempt);
			const errMessage = err instanceof Error ? err.message : String(err);
			console.warn(
				`[Gateway Proxy] fetch failed providerId=${route.providerId} error=${errMessage}`
			);
			const fetchClassification = classifyUpstreamFetchFailure();
			recordRouteStabilityFailure(route.targetId, 'error');
			recordBanditFailure(route.targetId);
			if (route.providerKeyFingerprint) {
				markKeyFailure(route.providerKeyFingerprint, 'server');
			}
			if (
				stickySession &&
				isStickyAttempt &&
				shouldInvalidateStickyBinding(fetchClassification)
			) {
				await clearStickyBindingSync(repos, stickySession);
				stickyAttemptCleared = true;
			}
			// 与 route_resolution_failed 一致：把 fetch 层原文带给客户端（DNS/TLS/abort 等，不含凭据）
			lastResponse = gatewayErrorResponse({
				status: 502,
				code: GatewayErrorCode.upstreamRequestFailed,
				message: errMessage.trim()
					? `Upstream request failed: ${errMessage.trim()}`
					: 'Upstream request failed',
			});
			lastRoute = route;
			continue;
		} finally {
			if (hedgeTimer) {
				clearTimeout(hedgeTimer);
				hedgeTimer = undefined;
			}
		}

		lastResponse = response;
		lastRoute = route;

		if (response.ok) {
			timing?.markFinalAttempt(timingAttempt);
			markProviderSuccess(route.providerId);
			recordProviderSuccess(route.providerId);
			recordProviderRequest(route.providerId);
			recordRouteStabilitySuccess(route.targetId);
			recordBanditSuccess(route.targetId);
			if (route.providerKeyFingerprint) {
				markKeySuccess(route.providerKeyFingerprint);
			}
			if (stickySession) {
				if (isStickyAttempt && stickySession.bindingToken) {
					scheduleStickyTouchIfNeeded(repos, stickySession);
				} else if (stickySession.lookup !== 'invalid_circuit') {
					// invalid_circuit: keep the existing binding until the provider cools down;
					// tryBind would lose to CAS on a still-fresh row.
					scheduleStickyBind(repos, stickySession, route, {
						rebound:
							stickyAttemptCleared ||
							stickySession.lookup === 'hit' ||
							stickySession.lookup === 'invalid_target',
					});
				}
			}
			return finish({
				response,
				usagePromise,
				upstreamRequestId,
				chosenRoute: route,
				circuitEvents,
				suppressErrorAlert: false,
				meta: dispatchMeta,
			});
		}

		const classification: UpstreamFailureClassification = shouldFailImmediatelyForImageAbort(dispatchMeta)
			? { action: 'fail_immediately' }
			: classifyUpstreamHttpFailure(response.status);
		logProviderSwitchAlert(route, classification, response.status);

		if (
			stickySession &&
			isStickyAttempt &&
			shouldInvalidateStickyBinding(classification, {
				imageAbort: shouldFailImmediatelyForImageAbort(dispatchMeta),
			})
		) {
			await clearStickyBindingSync(repos, stickySession);
			stickyAttemptCleared = true;
		}

		if (classification.action === 'fail_immediately') {
			timing?.markFinalAttempt(timingAttempt);
			return finish({
				response,
				usagePromise: Promise.resolve(EMPTY_USAGE),
				upstreamRequestId,
				chosenRoute: route,
				circuitEvents,
				suppressErrorAlert: false,
				meta: dispatchMeta,
			});
		}

		if (classification.failureKind) {
			recordRouteStabilityFailure(route.targetId, 'error');
			recordBanditFailure(route.targetId);
			if (route.providerKeyFingerprint) {
				markKeyFailure(route.providerKeyFingerprint, classification.failureKind);
			}
			const circuitResult = markProviderFailure(
				route.providerId,
				classification.failureKind,
				classification.failureKind === 'rate_limit'
					? parseRetryAfterMs(response.headers.get('retry-after'))
					: null
			);
			// 记录速率限制事件到 rate tracker
			if (classification.failureKind === 'rate_limit') {
				recordRateLimitEvent(route.providerId);
			}
			if (circuitResult.openedOrExtended) {
				circuitEvents.push({
					kind: 'provider',
					providerId: route.providerId,
					providerName: route.providerName,
					keyFingerprint:
						route.providerKeyFingerprint ?? fingerprintProviderApiKey(route.providerApiKey),
					failureKind: circuitResult.failureKind,
					openUntil: circuitResult.openUntil,
					cooldownMs: circuitResult.cooldownMs,
					openedOrExtended: true,
				});
			}
		} else if (response.status === 404) {
			// 404：路由配置问题（模型名/路径不对），只记录 route 稳定性失败，不触发 provider 熔断
			recordRouteStabilityFailure(route.targetId, 'error');
			recordBanditFailure(route.targetId);
			// 404 不算 key 故障，不触发 key 级熔断（可能是模型名映射问题，换 key 也无用）
		}
		if (hasNextAttempt) timing?.markAttemptFailover(timingAttempt);
		console.warn(
			`[Gateway Proxy] provider non-OK, trying next candidate providerId=${route.providerId} status=${response.status}`
		);
	}

	if (!lastResponse) {
		return finish({
			response: gatewayErrorResponse({
				status: 502,
				code: GatewayErrorCode.noRoute,
				message: 'No supported upstream protocol route available',
			}),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			chosenRoute: lastRoute,
			circuitEvents,
			suppressErrorAlert: false,
		});
	}

	timing?.markFinalAttempt(lastTimingAttempt);
	return finish({
		response: lastResponse,
		usagePromise: Promise.resolve(EMPTY_USAGE),
		upstreamRequestId: null,
		chosenRoute: lastRoute,
		circuitEvents,
		suppressErrorAlert: false,
	});
}

/** @deprecated 使用 {@link failoverDispatch} */
export const failoverDispatchWithKeyPool = failoverDispatch;
