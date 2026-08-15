/**
 * 用户路由：`POST /v1/responses`（OpenAI Responses 协议），供 codex++ / Codex CLI 接入。
 * 逻辑与 chat/messages 对称，仅上游 driver 与协议筛选不同。
 */
import { Hono } from 'hono';
import type { Env } from '../../app';
import { requireApiKey } from '../../middleware/auth';
import {
  resolveRoutesForSurface,
  type RouteResult,
} from '../../services/model-router';
import { resolveModelRouting } from '../../services/resolve-model-route-group';
import {
  buildAffinityKey,
  buildTierKeyPrefix,
  resolveRouteStrategyPlan,
} from '../../services/route-strategies';
import { proxyResponses, EMPTY_USAGE, type UsageFromStream } from '../../services/proxy';
import { finalizeRequestLogJson } from '../../services/request-log-shared';
import { summarizeOpenAiToolsForLog } from '../../services/request-log-tools-summary';
import { buildRouteRequestBody } from '../../services/route-default-params';
import { recordUsage } from '../../services/usage-tracker';
import { scheduleBackgroundWork } from '../../runtime/schedule-background-work';
import { stickyConfigFromSurface } from '../../services/provider-sticky-routing';
import {
  computeRequestLogStatus,
  formatHttpErrorTextForRequestLog,
  materializeNonOkResponse,
} from '../../services/request-log-record-status';
import {
  maybeBlockUserModelCircuit,
  maybeTriggerUserModelCircuitFromUpstream,
  markUserModelSuccess,
} from '../../services/user-model-circuit-route';
import { GatewayErrorCode } from '../../services/gateway-error-codes';
import { gatewayErrorJson } from '../../services/gateway-error-response';
import { RequestTimingCollector } from '../../services/request-timing';

/** 流若长期不结束（上游挂死），超过此时长仍无 usage 则按 incomplete 记账；正常/取消场景通常很快结束。 */
const USAGE_SAFETY_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

/** OpenAI Responses：去掉消息与内嵌多模态 data，保留采样/工具等元数据。 */
function openAiResponsesBodyRedactedForLog(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'input' || k === 'prompt' || k === 'data') {
      continue;
    }
    if (k === 'tools') {
      Object.assign(out, summarizeOpenAiToolsForLog(v));
      continue;
    }
    out[k] = v;
  }
  if (Array.isArray(body.input)) {
    out._input_items_count = body.input.length;
  }
  return out;
}

function openAiResponsesRequestBodyForLog(body: Record<string, unknown>): string | null {
  return finalizeRequestLogJson(openAiResponsesBodyRedactedForLog(body));
}

/** 与 openai-responses-driver 一致：`{ ...buildRouteRequestBody, model }` 再脱敏（与 chat 分写，便于日后分叉）。 */
function openAiResponsesUpstreamWireBodyForLog(route: RouteResult, body: Record<string, unknown>): string | null {
  const merged = buildRouteRequestBody(route, body);
  const wire = { ...merged, model: route.providerModelName };
  return finalizeRequestLogJson(openAiResponsesBodyRedactedForLog(wire));
}

/** 是否已从流/响应中拿到任一有效 token 计数（用于判定 incomplete）。 */
function hasUsage(u: UsageFromStream): boolean {
  return u.total_tokens > 0 || u.input_tokens > 0 || u.output_tokens > 0;
}

/** 本路由在根 `Env` 上收窄 `Variables.apiKey` 为必填。 */
type ResponsesEnv = Env & { Variables: { apiKey: import('../../middleware/auth').ApiKeyContext } };

export const responsesRoutes = new Hono<ResponsesEnv>();

responsesRoutes.use('*', requireApiKey);

/** body 须含 `model`；流式结束时异步记账，含 usage 兜底超时。 */
responsesRoutes.post('/', async (c) => {
  const repos = c.get('repositories');
  const apiKey = c.get('apiKey');
  const start = Date.now();
  const timing = new RequestTimingCollector();

  let body: { model?: string; [k: string]: unknown };
  try {
    body = await c.req.json();
  } catch {
    return gatewayErrorJson(c, {
      status: 400,
      code: GatewayErrorCode.invalidJson,
      message: 'Invalid JSON body',
    });
  }

  const rawModelId = typeof body.model === 'string' ? body.model.trim() : null;
  if (!rawModelId) {
    return gatewayErrorJson(c, {
      status: 400,
      code: GatewayErrorCode.missingModel,
      message: 'Missing model',
    });
  }

  const resolved = await resolveModelRouting(repos, rawModelId);
  if (!resolved) {
    return gatewayErrorJson(c, {
      status: 404,
      code: GatewayErrorCode.modelNotFound,
      message: 'Model not found',
    });
  }
  const { model, baseModelId, explicitGroup, isAutoSelected, autoCandidates } = resolved;
  const effectiveRouteGroup = explicitGroup?.trim() || 'default';

  if (apiKey.budgetMax != null && apiKey.budgetSpent >= apiKey.budgetMax) {
    return gatewayErrorJson(c, {
      status: 403,
      code: GatewayErrorCode.budgetExceeded,
      message: 'Budget exceeded',
    });
  }

  let routes: RouteResult[];
  let poolStrategy: string | null = null;
  let poolTierStrategies: string | null = null;
  let stickySurface: import('@cloud-api/core').ResolvedModelSurfaceRow | null = null;
  try {
    // auto 模式：合并所有候选模型的路由，使 failover 能跨模型切换（首选在首位）
    const candidateIds = isAutoSelected && autoCandidates?.length
      ? autoCandidates.map((m) => m.id)
      : [baseModelId];
    const mergedRoutes: RouteResult[] = [];
    for (const candId of candidateIds) {
      const resolvedSurface = await resolveRoutesForSurface(repos, {
        modelId: candId,
        routeGroup: effectiveRouteGroup,
        requestProtocol: 'openai',
        requestOperation: 'responses',
      });
      if (poolStrategy == null) {
        poolStrategy = resolvedSurface.surface?.pool_strategy ?? null;
        poolTierStrategies = resolvedSurface.surface?.pool_tier_strategies ?? null;
        stickySurface = resolvedSurface.surface;
      }
      mergedRoutes.push(...resolvedSurface.routes);
    }
    routes = mergedRoutes;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Model route resolution failed';
    console.error('[Gateway Responses] model route resolution failed', { baseModelId, err });
    return gatewayErrorJson(c, {
      status: 502,
      code: GatewayErrorCode.routeResolutionFailed,
      message,
    });
  }

  if (routes.length === 0) {
    console.warn('[Gateway Responses] no openai responses route for model', { baseModelId, effectiveRouteGroup });
    return gatewayErrorJson(c, {
      status: 502,
      code: GatewayErrorCode.noRoute,
      message: `No OpenAI Responses route in route group "${effectiveRouteGroup}" for this model`,
    });
  }

  console.log(
    `[Gateway Responses] forwarding baseModelId=${baseModelId} clientModel=${rawModelId}${isAutoSelected ? ' (auto-selected)' : ''} providerIds=${routes.map((r) => r.providerId).join(',')} keyId=${apiKey.keyId}`
  );

  const modelNameForLog =
    model.display_name != null && String(model.display_name).trim() !== ''
      ? String(model.display_name).trim()
      : baseModelId;
  const requestBodyForLog = openAiResponsesRequestBodyForLog(body as Record<string, unknown>);

  const circuitBlocked = maybeBlockUserModelCircuit(c, repos, apiKey, {
    baseModelId,
    modelNameForLog,
    requestBodyForLog,
    requestProtocol: 'openai',
    startMs: start,
    timing,
  });
  if (circuitBlocked) {
    return circuitBlocked;
  }

  const requestSignal = c.req.raw.signal;
  const strategyPlan = await resolveRouteStrategyPlan({
    routePolicyRaw: model.route_policy ?? null,
    poolStrategy,
    poolTierStrategies,
    protocol: 'openai',
    capability: 'responses',
    routeGroup: effectiveRouteGroup,
    repos,
  });
  const affinityKey = buildAffinityKey(apiKey.userId, baseModelId, effectiveRouteGroup, 'openai');
  const tierKeyPrefix = buildTierKeyPrefix(baseModelId, effectiveRouteGroup, 'openai');
  timing.markGatewayComplete();
  const proxyResult = await proxyResponses(repos, routes, body, requestSignal, {
    affinityKey,
    tierKeyPrefix,
    strategy: strategyPlan.base,
    tierStrategies: strategyPlan.tierOverrides,
    timing,
    routePoolId: stickySurface?.route_pool_id ?? routes[0]?.routePoolId ?? null,
    sticky: stickyConfigFromSurface(stickySurface),
  });
  const {
    usagePromise,
    chosenRoute,
    upstreamRequestId,
    circuitEvents,
    suppressErrorAlert,
    stickyTrace,
    stickyMutationPromise,
  } = proxyResult;
  if (stickyMutationPromise) {
    scheduleBackgroundWork(c, stickyMutationPromise);
  }
  const { response, errorBodyText } = await materializeNonOkResponse(proxyResult.response);

  let userModelCircuitEvent = null;
  if (response.ok) {
    markUserModelSuccess(apiKey.userId, baseModelId);
    // Track route success: reset consecutive failures
    if (chosenRoute.targetId) {
      scheduleBackgroundWork(c, repos.modelRouting.recordRouteSuccess(chosenRoute.targetId).catch((err) => {
        console.warn('[RouteTrack] recordRouteSuccess failed:', err instanceof Error ? err.message : String(err));
      }));
    }
  } else if (errorBodyText != null) {
    userModelCircuitEvent = maybeTriggerUserModelCircuitFromUpstream(
      apiKey.userId,
      baseModelId,
      response.status,
      response.headers.get('content-type'),
      errorBodyText,
      formatHttpErrorTextForRequestLog(
        response.status,
        response.headers.get('content-type'),
        errorBodyText
      )
    );
    // Track route failure: increment consecutive failures, auto-disable after 3
    if (chosenRoute.targetId) {
      scheduleBackgroundWork(c, (async () => {
        try {
          const failureCount = await repos.modelRouting.recordRouteFailure(chosenRoute.targetId);
          if (failureCount >= 3) {
            await repos.modelRouting.autoDisableRoute(chosenRoute.targetId);
            console.warn(`[RouteTrack] route ${chosenRoute.targetId} disabled after ${failureCount} consecutive failures`);
          }
        } catch (err) {
          console.warn('[RouteTrack] failure tracking failed:', err instanceof Error ? err.message : String(err));
        }
      })());
    }
  }

  const alertCircuitEvents = userModelCircuitEvent
    ? [...circuitEvents, userModelCircuitEvent]
    : circuitEvents;

  const usageOrSafety = Promise.race([
    usagePromise.then((u) => ({
      usage: u,
      // 上游不返回 usage 但确实流出了内容（streamedContent）时，不算 incomplete
      incomplete: !hasUsage(u) && !u.streamedContent,
      timedOut: false as const,
    })),
    new Promise<{ usage: typeof EMPTY_USAGE; incomplete: true; timedOut: true }>((resolve) =>
      setTimeout(
        () => resolve({ usage: EMPTY_USAGE, incomplete: true, timedOut: true }),
        USAGE_SAFETY_TIMEOUT_MS
      )
    ),
  ]);

  scheduleBackgroundWork(
    c,
    usageOrSafety
      .then(async ({ usage: usageCollected, incomplete, timedOut }) => {
        const latency = Date.now() - start;
        if (timedOut) timing.markStreamComplete();
        const status = computeRequestLogStatus({
          cancelled: Boolean(usageCollected.cancelled),
          responseOk: response.ok,
          incomplete,
        });
        let errorMessage: string | undefined;
        if (status === 'success') {
          errorMessage = undefined;
        } else if (status === 'cancelled') {
          errorMessage = 'Client disconnected (e.g. user cancelled)';
        } else if (status === 'incomplete') {
          errorMessage = timedOut
            ? 'Stream usage timeout (no usage within limit)'
            : 'Stream ended before usage available';
        } else if (errorBodyText != null) {
          errorMessage = formatHttpErrorTextForRequestLog(
            response.status,
            response.headers.get('content-type'),
            errorBodyText
          );
        } else {
          errorMessage = `HTTP ${response.status}`;
        }
        const upstreamRequestBodyForLog = openAiResponsesUpstreamWireBodyForLog(
          chosenRoute,
          body as Record<string, unknown>
        );
        return recordUsage(repos, {
          api_key_id: apiKey.keyId,
          user_id: apiKey.userId,
          user_email: apiKey.userEmail,
          model_id: baseModelId,
          provider_id: chosenRoute.providerId,
          provider_model_name: chosenRoute.providerModelName,
          model_name: modelNameForLog,
          provider_name: chosenRoute.providerName,
          request_body: requestBodyForLog,
          upstream_request_body: upstreamRequestBodyForLog,
          request_protocol: 'openai',
          request_operation: 'responses',
          upstream_protocol: chosenRoute.upstreamProtocol,
          upstream_operation: chosenRoute.upstreamOperation,
          model_surface_id: chosenRoute.modelSurfaceId,
          route_pool_id: chosenRoute.routePoolId,
          route_target_id: chosenRoute.targetId,
          adapter: chosenRoute.adapter,
          sticky_trace: stickyTrace ? await stickyTrace() : null,
          usage: usageCollected,
          model_pricing_profile: model.pricing_profile ?? null,
          route_price_override_json: chosenRoute.priceOverrideRaw,
          route_metered_profile_json: chosenRoute.routeMeteredProfileJson,
          route_charged_profile_json: chosenRoute.routeChargedProfileJson,
          request_started_at_ms: start,
          route_group: chosenRoute.routeGroup,
          status,
          latency_ms: latency,
          timing: timing.snapshot(),
          error_message: errorMessage,
          provider_key_id: chosenRoute.providerKeyId ?? null,
          provider_key_label: chosenRoute.providerKeyLabel ?? null,
          provider_key_fingerprint: chosenRoute.providerKeyFingerprint ?? null,
          upstream_request_id: upstreamRequestId,
          upstream_message_id: usageCollected.upstreamMessageId ?? null,
          circuit_events: alertCircuitEvents.length > 0 ? alertCircuitEvents : undefined,
          suppress_error_alert: suppressErrorAlert || undefined,
        });
      })
      .catch((err) => {
        console.error(
          `[Gateway Responses] recordUsage failed baseModelId=${baseModelId} keyId=${apiKey.keyId} error=${err instanceof Error ? err.message : String(err)}`
        );
      })
  );

  // 添加聚合路由响应头
  try {
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('X-Routed-Via', `${chosenRoute.providerName}/${chosenRoute.providerModelName}`);
    if (proxyResult.attemptCount > 1) {
      responseHeaders.set('X-Fallback-Attempts', String(proxyResult.attemptCount - 1));
    }
    if (isAutoSelected) {
      responseHeaders.set('X-Auto-Model', baseModelId);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (headerErr) {
    // 如果添加响应头失败，直接返回原始响应
    console.warn('[Gateway Responses] failed to add routing headers', headerErr);
    return response;
  }
});
