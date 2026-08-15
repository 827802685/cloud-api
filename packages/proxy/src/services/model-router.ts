/**
 * 模型路由解析：把 `model_routes` 行 + `providers` 拼成可上游请求的 `RouteResult`
 *（`providerEndpoints`、协议、`price_override`、单键 `api_key` 等）。
 * 与 `route-selection` 配合：本模块负责「行 → 可调用对象」，不负责选哪几条 failover。
 * 完整上游 URL 由各 driver 按 capability 调用 `resolveUpstreamEndpoint`。
 */
import type {
	GatewayRepositories,
	ModelRouteRow,
	ProviderEndpointsMap,
	ResolvedModelSurfaceRow,
	UpstreamProtocol,
} from '@cloud-api/core';
import {
	effectiveUpstreamOperation,
	extractMeteredProfileFromPriceOverrideJson,
	extractChargedProfileFromPriceOverrideJson,
	fingerprintProviderApiKey,
	normalizeUpstreamProtocol,
	parseProviderEndpoints,
} from '@cloud-api/core';
import { selectActiveRouteRows } from './route-selection';

export interface RouteResult {
	/** `model_routes.id`; stable target identity for traces and admin deep links. */
	targetId: string;
	modelSurfaceId: string | null;
	routePoolId: string | null;
	providerId: string;
	/** `providers.name` 快照，供 `api_key_request_logs` 等落库 */
	providerName: string;
	providerModelName: string;
	upstreamProtocol: UpstreamProtocol;
	upstreamOperation: string;
	adapter: string;
	/**
	 * 解析后的 provider endpoints（`providers.endpoints`）。
	 * Driver 按 capability 调用 `resolveUpstreamEndpoint`。
	 */
	providerEndpoints: ProviderEndpointsMap;
	providerApiKey: string;
	/** 原始 `model_routes.price_override` JSON，供审计与嵌套 profile 解析 */
	priceOverrideRaw: string | null;
	/** 自 `price_override.metered` 解析出的 JSON 字符串（无则 null）；供应侧 `metered_cost` */
	routeMeteredProfileJson: string | null;
	/** 自 `price_override.charged` 解析出的 JSON 字符串（无则 null）；用户预算 `charged_cost` 优先于此 */
	routeChargedProfileJson: string | null;
	customParams: Record<string, unknown> | null;
	routeGroup: string;
	/** `model_routes.priority`；同层按 route strategy 排序 */
	routePriority: number;
	/** `model_routes.weight`；策略排序用，默认 1 */
	routeWeight: number;
	/** deprecated log fields — 写入 provider id/name/fingerprint */
	providerKeyId?: string | null;
	providerKeyLabel?: string | null;
	providerKeyFingerprint?: string | null;
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// ignored by caller
	}
	return null;
}

/**
 * 去掉模型 id 的 `vendor/` 前缀，得到上游真实模型名。
 * 模型 id 可能形如 `google/gemini-3.1-flash-lite-preview` 或 `nvidia/deepseek-v3`，
 * 而上游（如 Google/Vertex）只认识 `gemini-3.1-flash-lite-preview`。
 * 仅当前缀与 vendor 一致时剥离；否则原样返回（避免误伤不含前缀的模型 id）。
 */
function stripVendorPrefix(modelId: string, vendor: string): string {
	const v = vendor?.toLowerCase().trim();
	if (!v) return modelId;
	const prefix = `${v}/`;
	if (modelId.toLowerCase().startsWith(prefix)) {
		return modelId.slice(prefix.length);
	}
	return modelId;
}

async function routeRowToResult(repos: GatewayRepositories, route: ModelRouteRow): Promise<RouteResult | null> {
	const provider = await repos.providers.getProviderById(route.provider_id);
	if (!provider || provider.status === 'disabled' || !provider.api_key) {
		return null;
	}
	const protocol = normalizeUpstreamProtocol(route.upstream_protocol);
	const providerEndpoints = parseProviderEndpoints(provider);
	const customParams = parseJsonObject(route.custom_params);
	if (route.custom_params && !customParams) {
		console.warn(
			`[Gateway Router] ignored invalid custom_params JSON routeId=${route.id} modelId=${route.model_id}`
		);
	}

	const routeGroup =
		typeof route.route_group === 'string' && route.route_group.trim() !== ''
			? route.route_group
			: 'default';

	const routeWeight = typeof route.weight === 'number' && route.weight > 0 ? route.weight : 1;

	return {
		targetId: route.id,
		modelSurfaceId: null,
		routePoolId: route.route_pool_id ?? null,
		providerId: provider.id,
		providerName: provider.name,
		providerModelName: route.provider_model_name,
		upstreamProtocol: protocol,
		upstreamOperation: route.upstream_operation ?? '*',
		adapter: route.adapter ?? 'passthrough',
		providerEndpoints,
		providerApiKey: provider.api_key,
		priceOverrideRaw: route.price_override,
		routeMeteredProfileJson: extractMeteredProfileFromPriceOverrideJson(route.price_override),
		routeChargedProfileJson: extractChargedProfileFromPriceOverrideJson(route.price_override),
		customParams,
		routeGroup,
		routePriority: route.priority,
		routeWeight,
		providerKeyId: provider.id,
		providerKeyLabel: provider.name,
		providerKeyFingerprint: fingerprintProviderApiKey(provider.api_key),
	};
}

export interface SurfaceRouteResolution {
	surface: ResolvedModelSurfaceRow | null;
	routes: RouteResult[];
}

/**
 * Resolve an ingress surface to its pool targets.
 *
 * Exact operation surfaces win; migrated wildcard surfaces are the compatibility fallback.
 * If migration 0016 has not been applied yet, the legacy model/group/protocol path remains
 * available so code and schema can be rolled out without a request outage.
 */
export async function resolveRoutesForSurface(
	repos: GatewayRepositories,
	params: {
		modelId: string;
		routeGroup: string;
		requestProtocol: UpstreamProtocol;
		requestOperation: string;
	}
): Promise<SurfaceRouteResolution> {
	// Auto-recovery: re-enable routes disabled > 24h ago (best-effort, non-blocking)
	try {
		await repos.modelRouting.recoverExpiredDisabledRoutes();
	} catch (err) {
		console.warn('[AutoRecovery] failed:', err instanceof Error ? err.message : String(err));
	}

	let surface: ResolvedModelSurfaceRow | null = null;
	try {
		surface = await repos.modelRouting.resolveModelSurface(params);
	} catch (error) {
		console.warn('[Gateway Router] surface lookup unavailable; using legacy route selection', {
			modelId: params.modelId,
			requestProtocol: params.requestProtocol,
			requestOperation: params.requestOperation,
			error: error instanceof Error ? error.message : String(error),
		});
	}

	const rows = surface
		? await repos.modelRouting.getModelRoutesByPoolId(surface.route_pool_id)
		: selectActiveRouteRows(
				await repos.modelRouting.getModelRoutesByModelId(params.modelId),
				params.routeGroup
			);
	let routes = (await resolveRouteResultsFromRows(repos, rows))
		.filter(
			(route) =>
				route.upstreamProtocol === params.requestProtocol &&
				route.adapter === 'passthrough'
		)
		.map((route) => ({
			...route,
			modelSurfaceId: surface?.id ?? null,
			upstreamOperation: effectiveUpstreamOperation(
				route.upstreamOperation,
				params.requestOperation
			),
		}));

	// Auto-route creation: if no routes found, try to create one automatically.
	// 仅当模型完全没有路由时才自动创建；若模型已有路由（即使全部被手动禁用），
	// 保持禁用状态，避免绕过管理员的禁用操作。
	// 例外：模型已有路由但全部是其他协议（如 gemini），当前请求协议（如 openai）无路由时，
	// 仍自动创建当前协议路由，避免 auto 选中后报 "No OpenAI route"。
	if (routes.length === 0) {
		try {
			const existingRoutes = await repos.routes.listModelRoutesWithJoins({ modelId: params.modelId });
			const hasMatchingProtocol = existingRoutes.some(
				(r) => normalizeUpstreamProtocol(r.upstream_protocol) === params.requestProtocol
			);
			if (existingRoutes.length > 0 && hasMatchingProtocol) {
				console.warn(
					`[AutoRoute] model=${params.modelId} has ${existingRoutes.length} route(s) but none active; skipping auto-create to respect manual disable`
				);
			} else {
				const model = await repos.modelRouting.getModelById(params.modelId);
				if (model) {
					const vendor = model.vendor?.toLowerCase().trim() ?? '';
					const providerId = await repos.modelRouting.findProviderByVendor(vendor);
					if (providerId) {
						const protocol = params.requestProtocol || 'openai';
						// 自动创建路由时 provider_model_name 去掉 `vendor/` 前缀：
						// 模型 id 可能形如 `google/gemini-3.1-flash-lite-preview`，而上游（如 Google）
						// 只认识 `gemini-3.1-flash-lite-preview`，带前缀会导致 404。
						const providerModelName = stripVendorPrefix(params.modelId, vendor);
						await repos.modelRouting.autoCreateRoute(
							params.modelId,
							providerId,
							providerModelName,
							protocol
						);
						console.log(
							`[AutoRoute] created route for model=${params.modelId} vendor=${vendor} protocol=${protocol} providerModelName=${providerModelName}`
						);
						// Re-query routes after creation
						const newRows = surface
							? await repos.modelRouting.getModelRoutesByPoolId(surface.route_pool_id)
							: selectActiveRouteRows(
									await repos.modelRouting.getModelRoutesByModelId(params.modelId),
									params.routeGroup
								);
						routes = (await resolveRouteResultsFromRows(repos, newRows))
							.filter(
								(route) =>
									route.upstreamProtocol === params.requestProtocol &&
									route.adapter === 'passthrough'
							)
							.map((route) => ({
								...route,
								modelSurfaceId: surface?.id ?? null,
								upstreamOperation: effectiveUpstreamOperation(
									route.upstreamOperation,
									params.requestOperation
								),
							}));
					} else {
						console.warn(`[AutoRoute] no active provider found for vendor=${vendor} model=${params.modelId}`);
					}
				}
			}
		} catch (err) {
			console.warn('[AutoRoute] failed:', err instanceof Error ? err.message : String(err));
		}
	}

	return { surface, routes };
}

/**
 * 将已筛选、已排序的 `model_routes` 行转为 `RouteResult[]`（顺序不变，通常应按 priority DESC）。
 * @param repos 网关仓储（按行查 provider）
 * @param rows 来自 `getModelRoutesByModelId` 或筛选子集
 * @returns 解析失败的行会被跳过（如 provider 缺失 / disabled / 无 api_key）
 */
export async function resolveRouteResultsFromRows(
	repos: GatewayRepositories,
	rows: ModelRouteRow[]
): Promise<RouteResult[]> {
	const result: RouteResult[] = [];
	for (const route of rows) {
		const r = await routeRowToResult(repos, route);
		if (r) {
			result.push(r);
		}
	}
	return result;
}

/**
 * 解析某统一模型 id 下全部 active 路由，按 priority 从高到低，供流式请求前故障转移依次尝试。
 * @param repos 网关仓储
 * @param modelId `models.id`（不含 `:route_group` 后缀）
 */
export async function resolveAllRoutes(repos: GatewayRepositories, modelId: string): Promise<RouteResult[]> {
	const routes = await repos.modelRouting.getModelRoutesByModelId(modelId);
	return resolveRouteResultsFromRows(repos, routes);
}

/**
 * 返回某模型下 active 路由的原始行（未 JOIN provider；供按协议过滤后再 `resolveRouteResultsFromRows`）。
 * @param repos 网关仓储
 * @param modelId `models.id`
 */
export async function getActiveModelRouteRows(repos: GatewayRepositories, modelId: string): Promise<ModelRouteRow[]> {
	return repos.modelRouting.getModelRoutesByModelId(modelId);
}

/**
 * 仅取最高一条路由（单路）。
 * @param repos 网关仓储
 * @param modelId `models.id`
 * @deprecated 请使用 `resolveAllRoutes` + proxy 故障转移。
 */
export async function resolveModel(repos: GatewayRepositories, modelId: string): Promise<RouteResult | null> {
	const routes = await resolveAllRoutes(repos, modelId);
	return routes.length > 0 ? routes[0]! : null;
}
