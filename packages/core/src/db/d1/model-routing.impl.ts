/**
 * D1：推理路径模型/路由查询。
 */
import type { ModelRow, ModelRouteRow } from '../../types';
import type { ResolvedModelSurfaceRow } from '../../route-topology';
import type { D1DatabaseClient } from '../../storage/database-client';
import type { ModelRoutingRepository } from '../../storage/gateway-repository-interfaces';

const LIST_MODELS_WITH_ACTIVE_ROUTES_SQL = `SELECT m.id, m.display_name, m.vendor, m.context_window, m.max_tokens, m.pricing_profile,
  (SELECT json_group_array(mt.tag) FROM model_tags mt WHERE mt.model_id = m.id) AS tags,
  (SELECT json_group_array(r.route_group) FROM model_routes r WHERE r.model_id = m.id AND r.status = 'active') AS route_groups,
  m.description, m.metadata, m.input_modalities, m.output_modalities, m.released_at, m.created_at
FROM models m
WHERE EXISTS (SELECT 1 FROM model_routes r WHERE r.model_id = m.id AND r.status = 'active')
ORDER BY m.id`;

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

		async listModelsWithActiveRoutes(): Promise<ModelRow[]> {
			try {
				const rows = await raw.prepare(LIST_MODELS_WITH_ACTIVE_ROUTES_SQL).all<ModelRow>();
				return rows.results ?? [];
			} catch {
				const list: ModelRow[] = [];
				let offset = 0;
				const sqlWithLimit = `${LIST_MODELS_WITH_ACTIVE_ROUTES_SQL} LIMIT 1 OFFSET ?`;
				while (true) {
					const row = await raw.prepare(sqlWithLimit).bind(offset).first<ModelRow>();
					if (!row) break;
					list.push(row);
					offset += 1;
				}
				return list;
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
			const v = vendor.toLowerCase().trim();
			// Map common vendor names to provider name patterns
			const patterns: Record<string, string[]> = {
				nvidia: ['nvidia'],
				google: ['google', 'gemini'],
				cloudflare: ['cloudflare'],
				openai: ['openai'],
				anthropic: ['anthropic'],
				mistral: ['mistral'],
				cohere: ['cohere'],
				deepseek: ['deepseek'],
			};
			const keywords = patterns[v] || [v];
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
