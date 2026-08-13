/**
 * MySQL：`api_key_request_logs` 读查询。
 */
import type { RowDataPacket } from 'mysql2/promise';
import { roundGatewayMoney, sqlMoneyRound } from '../../lib/money-precision';
import {
	mapRequestStatsByRangeRow,
	mapRequestTimeseriesRows,
	mapThroughputSnapshot,
	mapUserTokenTimeseriesRows,
	REQUEST_STATS_SELECT_SQL,
	REQUEST_TIMESERIES_SELECT_SQL,
} from '../../lib/dashboard-request-stats';
import type { RequestLogRow } from '../../types';
import type { MySqlDatabaseClient } from '../../storage/database-client';
import type { RequestLogsRepository } from '../../storage/gateway-repository-interfaces';
import type { InsertRequestLogParams } from '../request-logs-types';
import { asMySqlPool } from './mysql2-compat';
import { filterAllowedRequestLogStatuses } from '../request-log-status-filter';

export function createMySqlRequestLogsRepository(db: MySqlDatabaseClient): RequestLogsRepository {
	const pool = asMySqlPool(db.raw);
	return {
		async getRequestLogsByKeyId(
			apiKeyId: string,
			page: number,
			pageSize: number,
			filter?: { excludeStatus?: string; includeStatuses?: string[] }
		): Promise<{ logs: RequestLogRow[]; total: number }> {
			const offset = (page - 1) * pageSize;
			const include = filterAllowedRequestLogStatuses(filter?.includeStatuses);
			if (include.length > 0) {
				const placeholders = include.map(() => '?').join(', ');
				const [countRows] = await pool.query<(RowDataPacket & { total: string | number })[]>(
					`SELECT COUNT(*) AS total FROM api_key_request_logs
					 WHERE api_key_id = ? AND status IN (${placeholders})`,
					[apiKeyId, ...include]
				);
				const [rows] = await pool.query<RequestLogRow[]>(
					`SELECT * FROM api_key_request_logs
					 WHERE api_key_id = ? AND status IN (${placeholders})
					 ORDER BY created_at DESC LIMIT ? OFFSET ?`,
					[apiKeyId, ...include, pageSize, offset]
				);
				return {
					logs: rows,
					total: Number(countRows[0]?.total ?? 0),
				};
			}

			const excludeStatus = filter?.excludeStatus;
			if (excludeStatus) {
				const [countRows] = await pool.query<(RowDataPacket & { total: string | number })[]>(
					`SELECT COUNT(*) AS total FROM api_key_request_logs
					 WHERE api_key_id = ? AND (status IS NULL OR status <> ?)`,
					[apiKeyId, excludeStatus]
				);
				const [rows] = await pool.query<RequestLogRow[]>(
					`SELECT * FROM api_key_request_logs
					 WHERE api_key_id = ? AND (status IS NULL OR status <> ?)
					 ORDER BY created_at DESC LIMIT ? OFFSET ?`,
					[apiKeyId, excludeStatus, pageSize, offset]
				);
				return {
					logs: rows,
					total: Number(countRows[0]?.total ?? 0),
				};
			}

			const [countRows] = await pool.query<(RowDataPacket & { total: string | number })[]>(
				'SELECT COUNT(*) AS total FROM api_key_request_logs WHERE api_key_id = ?',
				[apiKeyId]
			);
			const [rows] = await pool.query<RequestLogRow[]>(
				'SELECT * FROM api_key_request_logs WHERE api_key_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
				[apiKeyId, pageSize, offset]
			);
			return {
				logs: rows,
				total: Number(countRows[0]?.total ?? 0),
			};
		},

		async getRequestLogs(options: {
			page?: number;
			pageSize?: number;
			apiKeyId?: string;
			userId?: string;
			userEmail?: string;
			modelId?: string;
			providerId?: string;
			routeGroup?: string;
			protocol?: string;
			status?: string;
			startDate?: string;
			endDate?: string;
		}): Promise<{ logs: RequestLogRow[]; total: number }> {
			const page = options.page || 1;
			const pageSize = Math.min(options.pageSize || 20, 100);
			const offset = (page - 1) * pageSize;
			const conditions: string[] = [];
			const bindValues: unknown[] = [];

			if (options.apiKeyId) {
				conditions.push('rl.api_key_id = ?');
				bindValues.push(options.apiKeyId);
			}
			if (options.userId) {
				conditions.push('rl.user_id = ?');
				bindValues.push(options.userId);
			}
			if (options.userEmail) {
				conditions.push('rl.user_email = ?');
				bindValues.push(options.userEmail);
			}
			if (options.modelId) {
				conditions.push('rl.model_id = ?');
				bindValues.push(options.modelId);
			}
			if (options.providerId) {
				conditions.push('rl.provider_id = ?');
				bindValues.push(options.providerId);
			}
			if (options.routeGroup) {
				conditions.push('rl.route_group = ?');
				bindValues.push(options.routeGroup);
			}
			if (options.protocol) {
				conditions.push("COALESCE(NULLIF(rl.request_protocol, ''), rl.upstream_protocol) = ?");
				bindValues.push(options.protocol);
			}
			if (options.status) {
				conditions.push('rl.status = ?');
				bindValues.push(options.status);
			}
			if (options.startDate) {
				conditions.push('rl.created_at >= ?');
				bindValues.push(options.startDate);
			}
			if (options.endDate) {
				conditions.push('rl.created_at <= ?');
				bindValues.push(options.endDate);
			}

			const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
			const [countRows] = await pool.query<(RowDataPacket & { total: string | number })[]>(
				`SELECT COUNT(*) AS total FROM api_key_request_logs rl ${whereClause}`,
				bindValues
			);
			const [rows] = await pool.query<RequestLogRow[]>(
				`SELECT rl.*, u.external_system AS external_system
				 FROM api_key_request_logs rl
				 LEFT JOIN users u ON u.id = rl.user_id
				 ${whereClause}
				 ORDER BY rl.created_at DESC LIMIT ? OFFSET ?`,
				[...bindValues, pageSize, offset]
			);
			return {
				logs: rows,
				total: Number(countRows[0]?.total ?? 0),
			};
		},

		async getRequestStatsByRange(options: {
			startDate: string;
			endDate: string;
			endExclusive?: boolean;
		}) {
			const comparator = options.endExclusive ? '<' : '<=';
			const [rows] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
				`SELECT
					${REQUEST_STATS_SELECT_SQL},
					COALESCE(${sqlMoneyRound('SUM(charged_cost)')}, 0) AS charged_cost,
					COALESCE(${sqlMoneyRound('SUM(metered_cost)')}, 0) AS metered_cost,
					COALESCE(${sqlMoneyRound('SUM(standard_cost)')}, 0) AS standard_cost
				 FROM api_key_request_logs WHERE created_at >= ? AND created_at ${comparator} ?`,
				[options.startDate, options.endDate]
			);
			return mapRequestStatsByRangeRow(rows[0] as Parameters<typeof mapRequestStatsByRangeRow>[0]);
		},

		async queryRequestTimeseries(options: {
			startDate: string;
			endDate: string;
			granularity: 'hour' | 'day';
		}) {
			const bucketExpr =
				options.granularity === 'hour'
					? "DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')"
					: "DATE_FORMAT(created_at, '%Y-%m-%d')";
			const [rows] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
				`SELECT
					${bucketExpr} AS bucket,
					${REQUEST_TIMESERIES_SELECT_SQL},
					COALESCE(${sqlMoneyRound('SUM(charged_cost)')}, 0) AS charged_cost
				 FROM api_key_request_logs
				 WHERE created_at >= ? AND created_at <= ?
				 GROUP BY bucket
				 ORDER BY bucket ASC`,
				[options.startDate, options.endDate]
			);
			return mapRequestTimeseriesRows(rows as Parameters<typeof mapRequestTimeseriesRows>[0]);
		},

		async queryUserTokenTimeseries(options: {
			startDate: string;
			endDate: string;
			granularity: 'hour' | 'day';
			userEmails: string[];
		}) {
			if (options.userEmails.length === 0) return [];
			const bucketExpr =
				options.granularity === 'hour'
					? "DATE_FORMAT(created_at, '%Y-%m-%d %H:00:00')"
					: "DATE_FORMAT(created_at, '%Y-%m-%d')";
			const placeholders = options.userEmails.map(() => '?').join(', ');
			const [rows] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
				`SELECT
					${bucketExpr} AS bucket,
					user_email,
					COALESCE(SUM(total_tokens), 0) AS total_tokens
				 FROM api_key_request_logs
				 WHERE created_at >= ? AND created_at <= ?
				   AND user_email IN (${placeholders})
				 GROUP BY bucket, user_email
				 ORDER BY bucket ASC`,
				[options.startDate, options.endDate, ...options.userEmails]
			);
			return mapUserTokenTimeseriesRows(rows as Parameters<typeof mapUserTokenTimeseriesRows>[0]);
		},

		async getThroughputLastMinute() {
			const end = new Date();
			const start = new Date(end.getTime() - 60 * 1000);
			const startDate = start.toISOString().slice(0, 19).replace('T', ' ');
			const endDate = end.toISOString().slice(0, 19).replace('T', ' ');
			const [rows] = await pool.query<(RowDataPacket & Record<string, unknown>)[]>(
				`SELECT
					COUNT(*) AS request_count,
					COALESCE(SUM(total_tokens), 0) AS total_tokens
				 FROM api_key_request_logs
				 WHERE created_at >= ? AND created_at <= ?`,
				[startDate, endDate]
			);
			return mapThroughputSnapshot(rows[0] as Parameters<typeof mapThroughputSnapshot>[0]);
		},

		async getRecentLogs(limit: number): Promise<RequestLogRow[]> {
			const [rows] = await pool.query<RequestLogRow[]>('SELECT * FROM api_key_request_logs ORDER BY created_at DESC LIMIT ?', [limit]);
			return rows;
		},

		async getRecentErrors(limit: number): Promise<RequestLogRow[]> {
			const [rows] = await pool.query<RequestLogRow[]>(
				`SELECT * FROM api_key_request_logs WHERE status = 'error' ORDER BY created_at DESC LIMIT ?`,
				[limit]
			);
			return rows;
		},

		async getDistinctActiveUsersCount(options: { startDate: string; endDate: string; endExclusive?: boolean }): Promise<number> {
			const comparator = options.endExclusive ? '<' : '<=';
			const [rows] = await pool.query<(RowDataPacket & { active_users?: string | number })[]>(
				`SELECT
					COUNT(DISTINCT CASE WHEN user_email IS NOT NULL AND user_email != '' THEN user_email END) AS active_users
				 FROM api_key_request_logs WHERE created_at >= ? AND created_at ${comparator} ?`,
				[options.startDate, options.endDate]
			);
			return Number(rows[0]?.active_users ?? 0);
		},

		async insertRequestLog(params: InsertRequestLogParams): Promise<void> {
			await pool.query(
				`INSERT INTO api_key_request_logs (
					id, user_id, api_key_id, user_email, model_id, provider_id, provider_model_name, model_name, provider_name,
					request_body, upstream_request_body, request_protocol, request_operation, upstream_protocol, upstream_operation,
					model_surface_id, route_pool_id, route_target_id, adapter, route_trace,
					input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, total_tokens,
					metered_cost, standard_cost, charged_cost, route_group, status, latency_ms,
					gateway_overhead_ms, upstream_response_ms, final_upstream_headers_ms, first_reasoning_token_ms, first_token_ms,
					stream_duration_ms, upstream_attempt_count, upstream_failover_count, timing_metadata, error_message, raw_usage,
					pricing_audit, provider_key_id, provider_key_label, provider_key_fingerprint, upstream_request_id, upstream_message_id,
					billing_kind, input_image_count, output_image_count, audio_duration_seconds
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					params.id,
					params.userId,
					params.apiKeyId,
					params.userEmail,
					params.modelId,
					params.providerId,
					params.providerModelName,
					params.modelName,
					params.providerName,
					params.requestBody,
					params.upstreamRequestBody,
					params.requestProtocol,
					params.requestOperation ?? null,
					params.upstreamProtocol,
					params.upstreamOperation ?? null,
					params.modelSurfaceId ?? null,
					params.routePoolId ?? null,
					params.routeTargetId ?? null,
					params.adapter ?? null,
					params.routeTrace ?? null,
					params.inputTokens,
					params.outputTokens,
					params.cacheReadTokens,
					params.cacheWriteTokens,
					params.reasoningTokens,
					params.totalTokens,
					String(roundGatewayMoney(params.meteredCost)),
					String(roundGatewayMoney(params.standardCost)),
					String(roundGatewayMoney(params.chargedCost)),
					params.routeGroup,
					params.status,
					params.latencyMs,
					params.gatewayOverheadMs ?? null,
					params.upstreamResponseMs ?? null,
					params.finalUpstreamHeadersMs ?? null,
					params.firstReasoningTokenMs ?? null,
					params.firstTokenMs ?? null,
					params.streamDurationMs ?? null,
					params.upstreamAttemptCount ?? null,
					params.upstreamFailoverCount ?? null,
					params.timingMetadata ?? null,
					params.errorMessage,
					params.rawUsage,
					params.pricingAudit ?? null,
					params.providerKeyId ?? null,
					params.providerKeyLabel ?? null,
					params.providerKeyFingerprint ?? null,
					params.upstreamRequestId ?? null,
					params.upstreamMessageId ?? null,
					params.billingKind ?? null,
					params.inputImageCount ?? 0,
					params.outputImageCount ?? 0,
					params.audioDurationSeconds ?? null,
				]
			);
		},
	};
}
