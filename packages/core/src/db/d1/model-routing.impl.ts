/**
 * D1：推理路径模型/路由查询。
 */
import type { ModelRow, ModelRouteRow } from '../../types';
import type { ResolvedModelSurfaceRow } from '../../route-topology';
import type { D1Database } from '@cloudflare/workers-types';
import type { D1DatabaseClient } from '../../storage/database-client';
import type { ModelRoutingRepository } from '../../storage/gateway-repository-interfaces';
import { vendorSearchKeywords } from '../vendor-keywords';

const LIST_MODELS_WITH_ACTIVE_ROUTES_SQL = `SELECT m.id, m.display_name, m.vendor, m.context_window, m.max_tokens, m.pricing_profile,
  (SELECT json_group_array(mt.tag) FROM model_tags mt WHERE mt.model_id = m.id) AS tags,
  (SELECT json_group_array(r.route_group) FROM model_routes r WHERE r.model_id = m.id AND r.status = 'active') AS route_groups,
  m.description, m.metadata, m.input_modalities, m.output_modalities, m.released_at, m.created_at
FROM models m
WHERE EXISTS (SELECT 1 FROM model_routes r WHERE r.model_id = m.id AND r.status = 'active')
ORDER BY m.id`;

const LIST_MODELS_WITH_ACTIVE_ROUTES_BY_PROTOCOL_SQL = `SELECT m.id, m.display_name, m.vendor, m.context_window, m.max_tokens, m.pricing_profile,
  (SELECT json_group_array(mt.tag) FROM model_tags mt WHERE mt.model_id = m.id) AS tags,
  (SELECT json_group_array(r.route_group) FROM model_routes r WHERE r.model_id = m.id AND r.status = 'active') AS route_groups,
  m.description, m.metadata, m.input_modalities, m.output_modalities, m.released_at, m.created_at
FROM models m
WHERE EXISTS (SELECT 1 FROM model_routes r WHERE r.model_id = m.id AND r.status = 'active' AND lower(r.upstream_protocol) = lower(?))
ORDER BY m.id`;

/** 回退批大小：D1 单语句最多 100 个绑定参数，留余量避免再次触发限制。 */
const FALLBACK_BATCH = 50;

/**
 * 是否属于已知的 D1 规划器/参数限制错误。
 * 仅对这些错误回退；其余错误如实抛出，避免掩盖真实故障（原实现 catch-all 掩盖一切）。
 */
function isD1PlannerFallbackError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	const lower = msg.toLowerCase();
	return (
		lower.includes('d1_error') ||
		lower.includes('planner') ||
		lower.includes('too many sql variables') ||
		lower.includes('maximum number of bound parameters') ||
		lower.includes('query is too complex')
	);
}

/**
 * 高效回退：先取有 active route 的 model id，再按 id 批量取模型/tags/route_groups。
 * 避免原实现逐行 `LIMIT 1 OFFSET ?` 的 O(n²) 扫描。
 */
async function listModelsWithActiveRoutesFallback(raw: D1Database, protocol?: string): Promise<ModelRow[]> {
	const idRows = await raw
		.prepare(
			protocol
				? "SELECT DISTINCT model_id FROM model_routes WHERE status = 'active' AND lower(upstream_protocol) = lower(?)"
				: "SELECT DISTINCT model_id FROM model_routes WHERE status = 'active'"
		)
		.bind(...(protocol ? [protocol] : []))
		.all<{ model_id: string }>();
	const modelIds = (idRows.results ?? []).map((r) => r.model_id);
	if (modelIds.length === 0) return [];

	const list: ModelRow[] = [];
	const tagsByModel = new Map<string, string[]>();
	const groupsByModel = new Map<string, string[]>();

	for (let i = 0; i < modelIds.length; i += FALLBACK_BATCH) {
		const batch = modelIds.slice(i, i + FALLBACK_BATCH);
		const placeholders = batch.map(() => '?').join(',');

		const rows = await raw
			.prepare(
				`SELECT id, display_name, vendor, context_window, max_tokens, pricing_profile,
				   description, metadata, input_modalities, output_modalities, released_at, created_at
				 FROM models WHERE id IN (${placeholders})`
			)
			.bind(...batch)
			.all<ModelRow>();
		list.push(...(rows.results ?? []));

		const tagRows = await raw
			.prepare(`SELECT model_id, tag FROM model_tags WHERE model_id IN (${placeholders})`)
			.bind(...batch)
			.all<{ model_id: string; tag: string }>();
		for (const r of tagRows.results ?? []) {
			const arr = tagsByModel.get(r.model_id) ?? [];
			arr.push(r.tag);
			tagsByModel.set(r.model_id, arr);
		}

		const groupRows = await raw
			.prepare(
				`SELECT model_id, route_group FROM model_routes
				 WHERE model_id IN (${placeholders}) AND status = 'active'`
			)
			.bind(...batch)
			.all<{ model_id: string; route_group: string }>();
		for (const r of groupRows.results ?? []) {
			const arr = groupsByModel.get(r.model_id) ?? [];
			arr.push(r.route_group);
			groupsByModel.set(r.model_id, arr);
		}
	}

	return list.map((m) => ({
		...m,
		tags: JSON.stringify(tagsByModel.get(m.id) ?? []),
		route_groups: JSON.stringify(groupsByModel.get(m.id) ?? []),
	}));
}

export function createD1ModelRoutingRepository(db: D1DatabaseClient): ModelRoutingRepository {
	const raw = db.raw;
	return {
		async getModelById(id: string): Promise<ModelRow | null> {
			return raw
				.prepare(
					`SELECT m.id, m.display_name, m.vendor, m.context_window, m.max_tokens, m.pricing_profile,
       (SELECT json_group_array(tag) FROM model_tags WHERE model_id = m.id) AS tags,
       m.description, m.metadata, m.input_modalities, m.output_modalities, m.released_at, m.route_policy, m.created_at
       FROM models m WHERE m.id = ?`
				)
				.bind(id)
				.first<ModelRow>();
		},

		async listModelsWithActiveRoutes(protocol?: string): Promise<ModelRow[]> {
			try {
				if (protocol) {
					const rows = await raw
						.prepare(LIST_MODELS_WITH_ACTIVE_ROUTES_BY_PROTOCOL_SQL)
						.bind(protocol)
						.all<ModelRow>();
					return rows.results ?? [];
				}
				const rows = await raw.prepare(LIST_MODELS_WITH_ACTIVE_ROUTES_SQL).all<ModelRow>();
				return rows.results ?? [];
			} catch (err) {
				// 仅对已知 D1 规划器/参数限制回退；其余错误如实抛出，避免掩盖真实故障
				if (!isD1PlannerFallbackError(err)) throw err;
				return listModelsWithActiveRoutesFallback(raw, protocol);
			}
		},

		async getModelRoutesByModelId(modelId: string): Promise<ModelRouteRow[]> {
			const rows = await raw
				.prepare('SELECT * FROM model_routes WHERE model_id = ? AND status = \'active\' ORDER BY priority DESC')
				.bind(modelId)
				.all<ModelRouteRow>();
			return rows.results ?? [];
		},

		async resolveModelSurface(params): Promise<ResolvedModelSurfaceRow | null> {
			return raw
				.prepare(
					`SELECT ms.*, rp.name AS pool_name, rp.strategy AS pool_strategy,
					        rp.tier_strategies AS pool_tier_strategies, rp.status AS pool_status,
					        rp.sticky_enabled AS pool_sticky_enabled,
					        rp.sticky_idle_ttl_seconds AS pool_sticky_idle_ttl_seconds,
					        rp.sticky_epoch AS pool_sticky_epoch
					 FROM model_surfaces ms
					 JOIN route_pools rp ON rp.id = ms.route_pool_id
					 WHERE ms.model_id = ?
					   AND lower(ms.route_group) = lower(?)
					   AND lower(ms.request_protocol) = lower(?)
					   AND ms.request_operation IN (?, '*')
					   AND ms.status = 'active'
					   AND rp.status = 'active'
					 ORDER BY CASE WHEN ms.request_operation = ? THEN 0 ELSE 1 END
					 LIMIT 1`
				)
				.bind(
					params.modelId,
					params.routeGroup,
					params.requestProtocol,
					params.requestOperation,
					params.requestOperation
				)
				.first<ResolvedModelSurfaceRow>();
		},

		async getModelRoutesByPoolId(poolId: string): Promise<ModelRouteRow[]> {
			const rows = await raw
				.prepare(
					`SELECT * FROM model_routes
					 WHERE route_pool_id = ? AND status = 'active'
					 ORDER BY priority DESC`
				)
				.bind(poolId)
				.all<ModelRouteRow>();
			return rows.results ?? [];
		},

		async recoverExpiredDisabledRoutes(): Promise<number> {
			const result = await raw
				.prepare(
					`UPDATE model_routes
					 SET status = 'active',
					     disabled_at = NULL,
					     consecutive_failures = 0
					 WHERE status = 'disabled'
					   AND disabled_at IS NOT NULL
					   AND disabled_at < datetime('now', '-24 hours')`
				)
				.run();
			const recovered = result.meta.changes ?? 0;
			if (recovered > 0) {
				console.log(`[AutoRecovery] re-enabled ${recovered} route(s) disabled > 24h ago`);
			}
			return recovered;
		},

		async recordRouteFailure(routeId: string): Promise<number> {
			const result = await raw
				.prepare(
					`UPDATE model_routes
					 SET consecutive_failures = consecutive_failures + 1
					 WHERE id = ?`
				)
				.bind(routeId)
				.run();
			if ((result.meta.changes ?? 0) === 0) return 0;
			const row = await raw
				.prepare('SELECT consecutive_failures FROM model_routes WHERE id = ?')
				.bind(routeId)
				.first<{ consecutive_failures: number }>();
			return Number(row?.consecutive_failures ?? 0);
		},

		async recordRouteSuccess(routeId: string): Promise<void> {
			await raw
				.prepare(
					`UPDATE model_routes
					 SET consecutive_failures = 0,
					     disabled_at = NULL,
					     status = 'active'
					 WHERE id = ?`
				)
				.bind(routeId)
				.run();
		},

		async autoDisableRoute(routeId: string): Promise<void> {
			await raw
				.prepare(
					`UPDATE model_routes
					 SET status = 'disabled',
					     disabled_at = datetime('now')
					 WHERE id = ?`
				)
				.bind(routeId)
				.run();
			console.warn(`[AutoDisable] route ${routeId} disabled after 3+ consecutive failures`);
		},

		async findProviderByVendor(vendor: string): Promise<string | null> {
			const keywords = vendorSearchKeywords(vendor);
			const primary = keywords[0] ?? vendor.toLowerCase().trim();
			// 1) 精确匹配厂商名本身（如 name = "google"），避免误匹配到名称里恰好含关键词的其他厂商
			const exact = await raw
				.prepare(
					`SELECT id FROM providers
					 WHERE status = 'active'
					   AND api_key != ''
					   AND lower(name) = lower(?)
					 LIMIT 1`
				)
				.bind(primary)
				.first<{ id: string }>();
			if (exact) return exact.id;
			// 2) 前缀匹配（如 "Google AI Studio"、"Google-Gemini"、"Google_Relay"），仍优先于子串
			const prefix = await raw
				.prepare(
					`SELECT id FROM providers
					 WHERE status = 'active'
					   AND api_key != ''
					   AND (lower(name) LIKE ? OR lower(name) LIKE ? OR lower(name) LIKE ? OR lower(name) LIKE ?)
					 LIMIT 1`
				)
				.bind(`${primary}%`, `${primary} %`, `${primary}-%`, `${primary}_%`)
				.first<{ id: string }>();
			if (prefix) return prefix.id;
			// 3) 回退：其余关键词子串匹配（含厂商名本身的子串）
			for (const kw of keywords) {
				const row = await raw
					.prepare(
						`SELECT id FROM providers
						 WHERE status = 'active'
						   AND api_key != ''
						   AND lower(name) LIKE ?
						 LIMIT 1`
					)
					.bind(`%${kw}%`)
					.first<{ id: string }>();
				if (row) return row.id;
			}
			return null;
		},

		async autoCreateRoute(
			modelId: string,
			providerId: string,
			providerModelName: string,
			upstreamProtocol: string
		): Promise<string> {
			const routeId = crypto.randomUUID();
			await raw
				.prepare(
					`INSERT INTO model_routes
					 (id, model_id, provider_id, provider_model_name, priority, status, route_group, weight, upstream_protocol, created_at, consecutive_failures)
					 VALUES (?, ?, ?, ?, 0, 'active', 'default', 5, ?, datetime('now'), 0)`
				)
				.bind(routeId, modelId, providerId, providerModelName, upstreamProtocol)
				.run();
			console.log(`[AutoRoute] created route ${routeId} for model ${modelId} → provider ${providerId}`);
			return routeId;
		},
	};
}
