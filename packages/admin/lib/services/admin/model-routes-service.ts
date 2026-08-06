/**
 * 管理后台 `model_routes` CRUD：校验上游协议与 provider 是否配置对应 base URL，并规范化 JSON 参数字段。
 */
import type { GatewayRepositories, UpstreamProtocol } from '@octafuse/core';
import {
	canonicalizeRequestOperation,
	isRequestOperationForProtocol,
	normalizeRouteOperation,
	PASSTHROUGH_ROUTE_ADAPTER,
} from '@octafuse/core';
import {
	isAudioTranscriptionModel,
	isImageGenerationModel,
} from '@octafuse/core/db/model-modalities';
import { normalizeUpstreamProtocol } from '@octafuse/core/upstream-protocol';
import { isRouteStrategyName } from '@octafuse/core/db/model-route-policy';
import { badRequest, notFound } from './errors';
import { coerceRoutePriceOverrideInput, assertRoutePriceOverrideFactors } from './pricing-input';
import { normalizeJsonObjectField, providerSupportsUpstreamProtocol } from './shared';
import type {
	AdminCreatedIdOutput,
	AdminModelRouteMutationInput,
	AdminModelRouteRow,
} from './types';

/** Image-generation catalog models may only use OpenAI Images–compatible routes. */
async function assertImageModelOpenaiProtocol(
	repos: GatewayRepositories,
	modelId: string,
	proto: 'openai' | 'anthropic' | 'gemini'
): Promise<void> {
	const model = await repos.models.getModelDetailWithRouteCounts(modelId);
	if (!model) return;
	if (
		isImageGenerationModel({
			output_modalities: model.output_modalities as string | null | undefined,
			pricing_profile: model.pricing_profile as string | null | undefined,
		}) &&
		proto !== 'openai'
	) {
		throw badRequest(
			'Image-generation models require upstream_protocol=openai (Gateway Images API only uses OpenAI routes).'
		);
	}
}

/** Audio transcription catalog models may only use OpenAI Audio–compatible routes. */
async function assertAudioModelOpenaiProtocol(
	repos: GatewayRepositories,
	modelId: string,
	proto: 'openai' | 'anthropic' | 'gemini'
): Promise<void> {
	const model = await repos.models.getModelDetailWithRouteCounts(modelId);
	if (!model) return;
	if (
		isAudioTranscriptionModel({
			pricing_profile: model.pricing_profile as string | null | undefined,
		}) &&
		proto !== 'openai'
	) {
		throw badRequest(
			'Audio transcription models require upstream_protocol=openai (Gateway Audio API only uses OpenAI routes).'
		);
	}
}

/**
 * 路由列表；`model_id` / `provider_id` 来自查询串，可选。
 */
export async function listModelRoutesService(
	repos: GatewayRepositories,
	filters: { model_id?: string; provider_id?: string }
): Promise<AdminModelRouteRow[]> {
	return (await repos.routes.listModelRoutesWithJoins({
		modelId: filters.model_id,
		providerId: filters.provider_id,
	})) as unknown as AdminModelRouteRow[];
}

/**
 * 创建路由：校验必填字段、JSON 参数、协议与 provider base URL 是否匹配。
 * @throws `badRequest` 校验失败
 */
export async function createModelRouteService(
	repos: GatewayRepositories,
	body: AdminModelRouteMutationInput
): Promise<AdminCreatedIdOutput> {
	const modelId = String(body.model_id ?? '');
	const providerId = String(body.provider_id ?? '');
	const providerModelName = String(body.provider_model_name ?? '');
	if (!modelId || !providerId || !providerModelName) {
		throw badRequest('model_id, provider_id, and provider_model_name are required');
	}

	const customParamsNorm = normalizeJsonObjectField(body.custom_params, 'custom_params');
	if (!customParamsNorm.ok) throw badRequest(customParamsNorm.message);

	let proto: 'openai' | 'anthropic' | 'gemini';
	try {
		proto = normalizeUpstreamProtocol(String(body.upstream_protocol ?? 'openai'));
	} catch (e) {
		throw badRequest(e instanceof Error ? e.message : 'Invalid upstream_protocol');
	}

	const provider = await repos.providers.getProviderProtocolBases(providerId);
	if (!provider) throw badRequest('Provider not found');
	if (!providerSupportsUpstreamProtocol(proto, provider)) {
		throw badRequest(`Provider has no base URL for upstream protocol "${proto}".`);
	}
	await assertImageModelOpenaiProtocol(repos, modelId, proto);
	await assertAudioModelOpenaiProtocol(repos, modelId, proto);

	const routeGroup =
		typeof body.route_group === 'string' && body.route_group.trim() !== '' ? body.route_group.trim() : 'default';
	let requestProtocol: UpstreamProtocol;
	try {
		requestProtocol = normalizeUpstreamProtocol(
			String(body.request_protocol ?? body.upstream_protocol ?? 'openai')
		);
	} catch (e) {
		throw badRequest(e instanceof Error ? e.message : 'Invalid request_protocol');
	}
	const requestOperation = canonicalizeRequestOperation(
		requestProtocol,
		normalizeRouteOperation(body.request_operation)
	);
	if (!isRequestOperationForProtocol(requestProtocol, requestOperation)) {
		throw badRequest(
			`request_operation "${requestOperation}" is not valid for request_protocol "${requestProtocol}"`
		);
	}
	const upstreamOperation = canonicalizeRequestOperation(
		proto,
		normalizeRouteOperation(body.upstream_operation)
	);
	if (!isRequestOperationForProtocol(proto, upstreamOperation)) {
		throw badRequest(
			`upstream_operation "${upstreamOperation}" is not valid for upstream_protocol "${proto}"`
		);
	}
	const adapter = String(body.adapter ?? PASSTHROUGH_ROUTE_ADAPTER).trim() || PASSTHROUGH_ROUTE_ADAPTER;
	if (adapter !== PASSTHROUGH_ROUTE_ADAPTER) {
		throw badRequest('Only adapter="passthrough" is supported in this release');
	}
	if (requestProtocol !== proto && adapter === PASSTHROUGH_ROUTE_ADAPTER) {
		throw badRequest('Cross-protocol targets require a conversion adapter');
	}
	if (
		adapter === PASSTHROUGH_ROUTE_ADAPTER &&
		requestOperation !== '*' &&
		upstreamOperation !== '*' &&
		requestOperation !== upstreamOperation
	) {
		throw badRequest('Different request and upstream operations require a conversion adapter');
	}

	const topology = await repos.routes.ensureModelSurfacePool({
		poolId: crypto.randomUUID(),
		surfaceId: crypto.randomUUID(),
		modelId,
		routeGroup,
		requestProtocol,
		requestOperation,
		poolName: `${requestProtocol}.${requestOperation} · ${routeGroup}`,
	});
	const id = crypto.randomUUID();
	const priceOverride = coerceRoutePriceOverrideInput(body.price_override);
	assertRoutePriceOverrideFactors(priceOverride);

	const weightRaw = body.weight;
	const weight =
		weightRaw === undefined || weightRaw === null || weightRaw === ''
			? 1
			: Number(weightRaw);
	if (!Number.isFinite(weight) || weight < 1) {
		throw badRequest('weight must be a number >= 1');
	}

	await repos.routes.insertModelRoute({
		id,
		modelId,
		providerId,
		providerModelName,
		priority: Number(body.priority ?? 0),
		weight: Math.floor(weight),
		status: String(body.status ?? 'active'),
		routeGroup,
		priceOverride,
		customParams: customParamsNorm.value,
		upstreamProtocol: proto,
		routePoolId: topology.poolId,
		upstreamOperation,
		adapter,
	});

	return { id };
}

/** 单条路由详情；不存在抛 `notFound`。 */
export async function getModelRouteService(repos: GatewayRepositories, id: string): Promise<AdminModelRouteRow> {
	const route = await repos.routes.getModelRouteRowById(id);
	if (!route) throw notFound('Route not found');
	return route as AdminModelRouteRow;
}

/**
 * 部分更新路由；键名与表列一致（snake_case）。无有效字段时直接返回。
 * @throws `badRequest` | `notFound`
 */
export async function updateModelRouteService(
	repos: GatewayRepositories,
	id: string,
	body: AdminModelRouteMutationInput
): Promise<void> {
	const patch = { ...body };
	delete patch.id;
	delete patch.request_protocol;
	delete patch.request_operation;
	if (patch.custom_params !== undefined) {
		const normalized = normalizeJsonObjectField(patch.custom_params, 'custom_params');
		if (!normalized.ok) throw badRequest(normalized.message);
		patch.custom_params = normalized.value;
	}
	if (patch.route_group !== undefined) {
		const g = String(patch.route_group).trim();
		if (g === '') throw badRequest('route_group cannot be empty');
		patch.route_group = g;
	}
	if (patch.weight !== undefined) {
		const weight = Number(patch.weight);
		if (!Number.isFinite(weight) || weight < 1) {
			throw badRequest('weight must be a number >= 1');
		}
		patch.weight = Math.floor(weight);
	}
	if (patch.price_override !== undefined) {
		const normalized = coerceRoutePriceOverrideInput(patch.price_override);
		assertRoutePriceOverrideFactors(normalized);
		patch.price_override = normalized;
	}
	if (patch.upstream_protocol !== undefined) {
		try {
			patch.upstream_protocol = normalizeUpstreamProtocol(String(patch.upstream_protocol));
		} catch (e) {
			throw badRequest(e instanceof Error ? e.message : 'Invalid upstream_protocol');
		}
	}
	const existing = await repos.routes.getModelRouteRowById(id);
	if (!existing) throw notFound('Route not found');
	const effectiveModelId =
		patch.model_id !== undefined ? String(patch.model_id) : String(existing.model_id);
	const effectiveProto = (patch.upstream_protocol !== undefined
		? patch.upstream_protocol
		: existing.upstream_protocol) as 'openai' | 'anthropic' | 'gemini';
	const effectiveProviderId =
		patch.provider_id !== undefined ? String(patch.provider_id) : String(existing.provider_id);
	const provider = await repos.providers.getProviderProtocolBases(effectiveProviderId);
	if (!provider) throw badRequest('Provider not found');
	if (!providerSupportsUpstreamProtocol(effectiveProto, provider)) {
		throw badRequest(`Provider has no base URL for upstream protocol "${effectiveProto}".`);
	}
	await assertImageModelOpenaiProtocol(repos, effectiveModelId, effectiveProto);
	await assertAudioModelOpenaiProtocol(repos, effectiveModelId, effectiveProto);

	const requestProtocolRaw = body.request_protocol;
	const requestOperationRaw = body.request_operation;
	const routeGroupChanging = patch.route_group !== undefined;
	const oldPoolId =
		existing.route_pool_id != null && String(existing.route_pool_id).trim() !== ''
			? String(existing.route_pool_id)
			: null;
	if (
		requestProtocolRaw !== undefined ||
		requestOperationRaw !== undefined ||
		routeGroupChanging
	) {
		let requestProtocol: UpstreamProtocol;
		try {
			requestProtocol = normalizeUpstreamProtocol(
				String(requestProtocolRaw ?? effectiveProto)
			);
		} catch (e) {
			throw badRequest(e instanceof Error ? e.message : 'Invalid request_protocol');
		}
		// When body omits request_operation (e.g. only route_group change), keep the
		// passthrough-aligned operation from the existing target instead of defaulting to '*'.
		const requestOperation = canonicalizeRequestOperation(
			requestProtocol,
			normalizeRouteOperation(
				requestOperationRaw !== undefined && requestOperationRaw !== null
					? requestOperationRaw
					: existing.upstream_operation
			)
		);
		if (!isRequestOperationForProtocol(requestProtocol, requestOperation)) {
			throw badRequest(
				`request_operation "${requestOperation}" is not valid for request_protocol "${requestProtocol}"`
			);
		}
		const effectiveAdapter =
			body.adapter === undefined
				? String(existing.adapter ?? PASSTHROUGH_ROUTE_ADAPTER)
				: String(body.adapter).trim() || PASSTHROUGH_ROUTE_ADAPTER;
		if (requestProtocol !== effectiveProto && effectiveAdapter === PASSTHROUGH_ROUTE_ADAPTER) {
			throw badRequest('Cross-protocol targets require a conversion adapter');
		}
		const effectiveUpstreamOperation = canonicalizeRequestOperation(
			effectiveProto,
			normalizeRouteOperation(body.upstream_operation ?? existing.upstream_operation)
		);
		if (
			effectiveAdapter === PASSTHROUGH_ROUTE_ADAPTER &&
			requestOperation !== '*' &&
			effectiveUpstreamOperation !== '*' &&
			requestOperation !== effectiveUpstreamOperation
		) {
			throw badRequest('Different request and upstream operations require a conversion adapter');
		}
		const effectiveGroup =
			patch.route_group !== undefined
				? String(patch.route_group)
				: String(existing.route_group ?? 'default');
		const topology = await repos.routes.ensureModelSurfacePool({
			poolId: crypto.randomUUID(),
			surfaceId: crypto.randomUUID(),
			modelId: effectiveModelId,
			routeGroup: effectiveGroup,
			requestProtocol,
			requestOperation,
			poolName: `${requestProtocol}.${requestOperation} · ${effectiveGroup}`,
		});
		patch.route_pool_id = topology.poolId;
	}
	if (patch.upstream_operation !== undefined) {
		const operation = canonicalizeRequestOperation(
			effectiveProto,
			normalizeRouteOperation(patch.upstream_operation)
		);
		if (!isRequestOperationForProtocol(effectiveProto, operation)) {
			throw badRequest(
				`upstream_operation "${operation}" is not valid for upstream_protocol "${effectiveProto}"`
			);
		}
		patch.upstream_operation = operation;
	}
	if (patch.adapter !== undefined) {
		const adapter = String(patch.adapter).trim() || PASSTHROUGH_ROUTE_ADAPTER;
		if (adapter !== PASSTHROUGH_ROUTE_ADAPTER) {
			throw badRequest('Only adapter="passthrough" is supported in this release');
		}
		patch.adapter = adapter;
	}

	const hasPatch = Object.values(patch).some((v) => v !== undefined);
	if (!hasPatch) return;
	const changes = await repos.routes.updateModelRouteByPatch(id, patch);
	if (!changes) throw notFound('Route not found');

	const newPoolId =
		patch.route_pool_id != null && String(patch.route_pool_id).trim() !== ''
			? String(patch.route_pool_id)
			: null;
	if (oldPoolId && newPoolId && oldPoolId !== newPoolId) {
		await repos.routes.deleteRoutePoolIfEmpty(oldPoolId);
	}
}

/** 删除路由；不存在抛 `notFound`。空 Pool / Surface 一并 GC。 */
export async function deleteModelRouteService(repos: GatewayRepositories, id: string): Promise<void> {
	const existing = await repos.routes.getModelRouteRowById(id);
	if (!existing) throw notFound('Route not found');
	const poolId =
		existing.route_pool_id != null && String(existing.route_pool_id).trim() !== ''
			? String(existing.route_pool_id)
			: null;
	const changes = await repos.routes.deleteModelRouteById(id);
	if (!changes) throw notFound('Route not found');
	if (poolId) {
		await repos.routes.deleteRoutePoolIfEmpty(poolId);
	}
}

/** Update the strategy owned by one concrete route pool. `null` inherits the model/global policy. */
export async function updateRoutePoolStrategyService(
	repos: GatewayRepositories,
	poolId: string,
	strategyInput: unknown
): Promise<void> {
	const raw = strategyInput == null ? '' : String(strategyInput).trim().toLowerCase();
	if (raw && !isRouteStrategyName(raw)) {
		throw badRequest(`Invalid route pool strategy "${raw}"`);
	}
	const changes = await repos.routes.updateRoutePoolStrategy(poolId, raw || null);
	if (!changes) throw notFound('Route pool not found');
}
