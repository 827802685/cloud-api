/**
 * MySQL：`model_routes`。
 */
import type { ResultSetHeader } from 'mysql2/promise';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { ModelRoutesRepository } from '../../storage/gateway-repository-interfaces';
import type { ModelRouteDetailRow, ModelRouteJoinRow } from '../../storage/repository-dtos';
import { MODEL_ROUTE_PATCH_COLS } from '../patch-allowlists';
import { asMySqlPool } from './mysql2-compat';

const MODEL_ROUTE_LIST_JOIN_SQL = `SELECT mr.id, mr.model_id, mr.provider_id, mr.provider_model_name, mr.priority, mr.status,
		mr.route_group, mr.weight, mr.price_override, mr.custom_params, mr.upstream_protocol,
		mr.route_pool_id, mr.upstream_operation, mr.adapter,
		rp.name AS pool_name, rp.strategy AS pool_strategy, rp.status AS pool_status,
		CAST(COALESCE((
			SELECT JSON_ARRAYAGG(JSON_OBJECT(
				'id', ms.id,
				'request_protocol', ms.request_protocol,
				'request_operation', ms.request_operation,
				'status', ms.status
			))
			FROM model_surfaces ms WHERE ms.route_pool_id = mr.route_pool_id
		), JSON_ARRAY()) AS CHAR) AS surfaces,
		m.display_name as model_name, p.name as provider_name
	 FROM model_routes mr
	 LEFT JOIN models m ON mr.model_id = m.id
	 LEFT JOIN providers p ON mr.provider_id = p.id
	 LEFT JOIN route_pools rp ON mr.route_pool_id = rp.id`;

export function createMySqlModelRoutesRepository(db: MySqlDatabaseClient): ModelRoutesRepository {
	const pool = asMySqlPool(db.raw);
	return {
		async listModelRoutesWithJoins(filters: { modelId?: string; providerId?: string }): Promise<ModelRouteJoinRow[]> {
			const conditions: string[] = [];
			const bindValues: unknown[] = [];
			if (filters.modelId) {
				conditions.push('mr.model_id = ?');
				bindValues.push(filters.modelId);
			}
			if (filters.providerId) {
				conditions.push('mr.provider_id = ?');
				bindValues.push(filters.providerId);
			}
			const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
			const sqlText = `${MODEL_ROUTE_LIST_JOIN_SQL} ${where} ORDER BY mr.model_id, mr.priority DESC`;
			const [rows] = await pool.query<ModelRouteJoinRow[]>(sqlText, bindValues);
			return rows;
		},

		async insertModelRoute(params: {
			id: string;
			modelId: string;
			providerId: string;
			providerModelName: string;
			priority: number;
			status: string;
			routeGroup: string;
			weight?: number;
			priceOverride: unknown;
			customParams: string | null;
			upstreamProtocol: string;
			routePoolId: string;
			upstreamOperation: string;
			adapter: string;
		}): Promise<void> {
			const now = new Date().toISOString();
			await pool.execute(
				`INSERT INTO model_routes (id, model_id, provider_id, provider_model_name, priority, status, route_group, weight, price_override, custom_params, upstream_protocol, route_pool_id, upstream_operation, adapter, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					params.id,
					params.modelId,
					params.providerId,
					params.providerModelName,
					params.priority,
					params.status,
					params.routeGroup,
					params.weight ?? 1,
					params.priceOverride ?? null,
					params.customParams,
					params.upstreamProtocol,
					params.routePoolId,
					params.upstreamOperation,
					params.adapter,
					now,
				]
			);
		},

		async getModelRouteRowById(id: string): Promise<ModelRouteDetailRow | null> {
			const [rows] = await pool.query<ModelRouteDetailRow[]>('SELECT * FROM model_routes WHERE id = ?', [id]);
			return rows[0] ?? null;
		},

		async ensureModelSurfacePool(params): Promise<{ poolId: string; surfaceId: string }> {
			const [existing] = await pool.query<Array<{ id: string; route_pool_id: string }>>(
				`SELECT id, route_pool_id
				 FROM model_surfaces
				 WHERE model_id = ? AND lower(route_group) = lower(?)
				   AND lower(request_protocol) = lower(?) AND request_operation = ?
				 LIMIT 1`,
				[
					params.modelId,
					params.routeGroup,
					params.requestProtocol,
					params.requestOperation,
				]
			);
			if (existing[0]) {
				return { poolId: existing[0].route_pool_id, surfaceId: existing[0].id };
			}

			const conn = await pool.getConnection();
			try {
				await conn.beginTransaction();
				await conn.execute(
					`INSERT INTO route_pools
					 (id, model_id, route_group, name, strategy, status, created_at, updated_at)
					 VALUES (?, ?, ?, ?, NULL, 'active', CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))`,
					[params.poolId, params.modelId, params.routeGroup, params.poolName]
				);
				await conn.execute(
					`INSERT INTO model_surfaces
					 (id, model_id, route_group, request_protocol, request_operation, route_pool_id, status, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))`,
					[
						params.surfaceId,
						params.modelId,
						params.routeGroup,
						params.requestProtocol,
						params.requestOperation,
						params.poolId,
					]
				);
				await conn.commit();
			} catch (error) {
				await conn.rollback();
				throw error;
			} finally {
				conn.release();
			}
			return { poolId: params.poolId, surfaceId: params.surfaceId };
		},

		async updateRoutePoolStrategy(poolId: string, strategy: string | null): Promise<number> {
			const [result] = await pool.execute<ResultSetHeader>(
				`UPDATE route_pools SET strategy = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?`,
				[strategy, poolId]
			);
			return result.affectedRows;
		},

		async updateModelRouteByPatch(id: string, patch: Record<string, unknown>): Promise<number> {
			const updateFields: string[] = [];
			const bindValues: unknown[] = [];
			for (const [key, value] of Object.entries(patch)) {
				if (value !== undefined && MODEL_ROUTE_PATCH_COLS.has(key)) {
					updateFields.push(`${key} = ?`);
					bindValues.push(value);
				}
			}
			if (updateFields.length === 0) return 0;
			const [result] = await pool.execute<ResultSetHeader>(
				`UPDATE model_routes SET ${updateFields.join(', ')} WHERE id = ?`,
				[...bindValues, id]
			);
			return result.affectedRows;
		},

		async deleteModelRouteById(id: string): Promise<number> {
			const [result] = await pool.execute<ResultSetHeader>('DELETE FROM model_routes WHERE id = ?', [id]);
			return result.affectedRows;
		},
	};
}
