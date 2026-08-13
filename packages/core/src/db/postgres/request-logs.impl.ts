/**
 * Postgres：`api_key_request_logs`（postgres.js + unsafe）。
 */
import { roundGatewayMoney, sqlMoneyRound } from '../../lib/money-precision';
import {
	mapRequestStatsByRangeRow,
	mapRequestTimeseriesRows,
	mapThroughputSnapshot,
	mapUserTokenTimeseriesRows,
} from '../../lib/dashboard-request-stats';
import type { RequestLogRow } from '../../types';
import type { PostgresDatabaseClient } from '../../storage/database-client';
import type { RequestLogsRepository } from '../../storage/gateway-repository-interfaces';
import type { InsertRequestLogParams } from '../request-logs-types';
import { sqlitePlaceholdersToPg } from '../shared/sql-placeholders';
import { filterAllowedRequestLogStatuses } from '../request-log-status-filter';

export function createPostgresRequestLogsRepository(db: PostgresDatabaseClient): RequestLogsRepository {
	const pg = db.raw;
	return {
		async insertRequestLog(params: InsertRequestLogParams): Promise<void> {
			await pg.unsafe(
				`INSERT INTO api_key_request_logs (id, user_id, api_key_id, user_email, model_id, provider_id, provider_model_name, model_name, provider_name, request_body, upstream_request_body, request_protocol, request_operation, upstream_protocol, upstream_operation, model_surface_id, route_pool_id, route_target_id, adapter, route_trace, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, total_tokens, metered_cost, standard_cost, charged_cost, route_group, status, latency_ms, gateway_overhead_ms, upstream_response_ms, final_upstream_headers_ms, first_reasoning_token_ms, first_token_ms, stream_duration_ms, upstream_attempt_count, upstream_failover_count, timing_metadata, error_message, raw_usage, pricing_audit, provider_key_id, provider_key_label, provider_key_fingerprint, upstream_request_id, upstream_message_id, billing_kind, input_image_count, output_image_count, audio_duration_seconds)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51, $52, $53)`,
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
					roundGatewayMoney(params.meteredCost),
					roundGatewayMoney(params.standardCost),
					roundGatewayMoney(params.chargedCost),
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

		async getRequestLogsByKeyId(
			apiKeyId: string,
			page: number,
			pageSize: number,
			filter?: { excludeStatus?: string; includeStatuses?: string[] }
		): Promise<{ logs: RequestLogRow[]; total: number }> {
			const offset = (page - 1) * pageSize;
			const include = filterAllowedRequestLogStatuses(filter?.includeStatuses);
			if (include.length > 0) {
				const countRows = await pg<{ total: string | number }[]>`
			SELECT COUNT(*)::bigint AS total FROM api_key_request_logs
			WHERE api_key_id = ${apiKeyId} AND status IN ${pg(include)}
		`;
				const total = Number(countRows[0]?.total ?? 0);
				const logs = await pg<RequestLogRow[]>`
			SELECT * FROM api_key_request_logs
			WHERE api_key_id = ${apiKeyId} AND status IN ${pg(include)}
			ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}
		`;
				return { logs, total };
			}
			const excludeStatus = filter?.excludeStatus;
			if (excludeStatus) {
				const countRows = await pg<{ total: string | number }[]>`
			SELECT COUNT(*)::bigint AS total FROM api_key_request_logs
			WHERE api_key_id = ${apiKeyId} AND (status IS NULL OR status <> ${excludeStatus})
		`;
				const total = Number(countRows[0]?.total ?? 0);
				const logs = await pg<RequestLogRow[]>`
			SELECT * FROM api_key_request_logs
			WHERE api_key_id = ${apiKeyId} AND (status IS NULL OR status <> ${excludeStatus})
			ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}
		`;
				return { logs, total };
			}
			const countRows = await pg<{ total: string | number }[]>`
		SELECT COUNT(*)::bigint AS total FROM api_key_request_logs WHERE api_key_id = ${apiKeyId}
	`;
			const total = Number(countRows[0]?.total ?? 0);
			const logs = await pg<RequestLogRow[]>`
		SELECT * FROM api_key_request_logs WHERE api_key_id = ${apiKeyId}
		ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}
	`;
			return { logs, total };
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

			const countSql = sqlitePlaceholdersToPg(`SELECT COUNT(*) as total FROM api_key_request_logs rl ${whereClause}`);
			const countRows = (await pg.unsafe(
				countSql,
				bindValues as Parameters<typeof pg.unsafe>[1]
			)) as { total: string | number }[];
			const total = Number(countRows[0]?.total ?? 0);

			const selectSql = sqlitePlaceholdersToPg(
				`SELECT rl.*, u.external_system AS external_system
				 FROM api_key_request_logs rl
				 LEFT JOIN users u ON u.id = rl.user_id
				 ${whereClause}
				 ORDER BY rl.created_at DESC LIMIT ? OFFSET ?`
			);
			const dataRows = (await pg.unsafe(
				selectSql,
				[...bindValues, pageSize, offset] as Parameters<typeof pg.unsafe>[1]
			)) as RequestLogRow[];
			return { logs: dataRows, total };
		},

		async getRequestStatsByRange(options: {
			startDate: string;
			endDate: string;
			endExclusive?: boolean;
		}) {
			const comparator = options.endExclusive ? '<' : '<=';
			const q = `SELECT
				COUNT(*)::bigint as total_requests,
				SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::bigint as success_count,
				SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::bigint as error_count,
				COALESCE(SUM(input_tokens), 0)::bigint as input_tokens,
				COALESCE(SUM(output_tokens), 0)::bigint as output_tokens,
				COALESCE(SUM(cache_read_tokens), 0)::bigint as cache_read_tokens,
				COALESCE(SUM(cache_write_tokens), 0)::bigint as cache_write_tokens,
				COALESCE(SUM(total_tokens), 0)::bigint as total_tokens,
				AVG(latency_ms) as avg_latency_ms,
				COALESCE(${sqlMoneyRound('SUM(charged_cost)')}, 0) as charged_cost,
				COALESCE(${sqlMoneyRound('SUM(metered_cost)')}, 0) as metered_cost,
				COALESCE(${sqlMoneyRound('SUM(standard_cost)')}, 0) as standard_cost
			 FROM api_key_request_logs WHERE created_at >= $1 AND created_at ${comparator} $2`;
			const rows = (await pg.unsafe(q, [options.startDate, options.endDate])) as Record<string, unknown>[];
			return mapRequestStatsByRangeRow(rows[0]);
		},

		async queryRequestTimeseries(options: {
			startDate: string;
			endDate: string;
			granularity: 'hour' | 'day';
		}) {
			const bucketExpr =
				options.granularity === 'hour'
					? "to_char(date_trunc('hour', created_at::timestamp), 'YYYY-MM-DD HH24:MI:SS')"
					: "to_char(date_trunc('day', created_at::timestamp), 'YYYY-MM-DD')";
			const q = `SELECT
				${bucketExpr} as bucket,
				COUNT(*)::bigint as request_count,
				COALESCE(SUM(input_tokens), 0)::bigint as input_tokens,
				COALESCE(SUM(output_tokens), 0)::bigint as output_tokens,
				COALESCE(SUM(cache_read_tokens), 0)::bigint as cache_read_tokens,
				COALESCE(SUM(cache_write_tokens), 0)::bigint as cache_write_tokens,
				COALESCE(SUM(total_tokens), 0)::bigint as total_tokens,
				AVG(latency_ms) as avg_latency_ms,
				COALESCE(${sqlMoneyRound('SUM(charged_cost)')}, 0) as charged_cost
			 FROM api_key_request_logs
			 WHERE created_at >= $1 AND created_at <= $2
			 GROUP BY 1
			 ORDER BY 1 ASC`;
			const rows = (await pg.unsafe(q, [options.startDate, options.endDate])) as Record<string, unknown>[];
			return mapRequestTimeseriesRows(rows);
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
					? "to_char(date_trunc('hour', created_at::timestamp), 'YYYY-MM-DD HH24:MI:SS')"
					: "to_char(date_trunc('day', created_at::timestamp), 'YYYY-MM-DD')";
			const emailParams = options.userEmails.map((_, i) => `$${i + 3}`).join(', ');
			const q = `SELECT
				${bucketExpr} as bucket,
				user_email,
				COALESCE(SUM(total_tokens), 0)::bigint as total_tokens
			 FROM api_key_request_logs
			 WHERE created_at >= $1 AND created_at <= $2
			   AND user_email IN (${emailParams})
			 GROUP BY 1, user_email
			 ORDER BY 1 ASC`;
			const rows = (await pg.unsafe(q, [options.startDate, options.endDate, ...options.userEmails])) as Record<string, unknown>[];
			return mapUserTokenTimeseriesRows(rows);
		},

		async getThroughputLastMinute() {
			const end = new Date();
			const start = new Date(end.getTime() - 60 * 1000);
			const startDate = start.toISOString().slice(0, 19).replace('T', ' ');
			const endDate = end.toISOString().slice(0, 19).replace('T', ' ');
			const q = `SELECT
				COUNT(*)::bigint as request_count,
				COALESCE(SUM(total_tokens), 0)::bigint as total_tokens
			 FROM api_key_request_logs
			 WHERE created_at >= $1 AND created_at <= $2`;
			const rows = (await pg.unsafe(q, [startDate, endDate])) as Record<string, unknown>[];
			return mapThroughputSnapshot(rows[0]);
		},

		async getRecentLogs(limit: number): Promise<RequestLogRow[]> {
			return (await pg.unsafe('SELECT * FROM api_key_request_logs ORDER BY created_at DESC LIMIT $1', [limit])) as RequestLogRow[];
		},

		async getRecentErrors(limit: number): Promise<RequestLogRow[]> {
			return (await pg.unsafe(
				`SELECT * FROM api_key_request_logs WHERE status = 'error' ORDER BY created_at DESC LIMIT $1`,
				[limit]
			)) as RequestLogRow[];
		},

		async getDistinctActiveUsersCount(options: { startDate: string; endDate: string; endExclusive?: boolean }): Promise<number> {
			const comparator = options.endExclusive ? '<' : '<=';
			const q = `SELECT
				COUNT(DISTINCT CASE WHEN user_email IS NOT NULL AND user_email != '' THEN user_email END)::bigint as active_users
			 FROM api_key_request_logs WHERE created_at >= $1 AND created_at ${comparator} $2`;
			const rows = (await pg.unsafe(q, [options.startDate, options.endDate])) as { active_users?: string | number }[];
			return Number(rows[0]?.active_users ?? 0);
		},
	};
}
