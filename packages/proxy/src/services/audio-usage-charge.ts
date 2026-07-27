/**
 * 音频转写计费：duration_seconds × price_per_second × 路由 factor。
 * 日志不落音频二进制；duration 来源写入 pricing_audit（upstream | estimated）。
 */
import type { GatewayRepositories, UpstreamProtocol } from '@octafuse/core';
import {
	changedFieldsToJson,
	computeAudioPerSecondMeteredCost,
	computeChangedFields,
	getBusinessTimezone,
	getUserBudgetSnapshot,
	insertRequestUsageAndChargeTx,
	parsePricingProfile,
	parseRouteBaseFactors,
	parseRoutePricingSchedule,
	PRICING_AUDIT_JSON_SCHEMA_VERSION,
	profileHasAudioPerSecondPricing,
	resolveAudioBillingMode,
	resolveBillableAudioSeconds,
	resolveDailyScheduleFactor,
	roundGatewayMoney,
	snapshotToJson,
	snapshotWithOverrides,
	userRowToSnapshot,
	type ParsedPricingProfile,
	type PriceResolutionAuditSide,
} from '@octafuse/core';
import { canAffordToolCost } from './tool-usage-charge';
import type { GatewayCircuitAlertEvent } from './circuit-alert-types';
import { fireGatewayErrorWebhooks } from './alert-webhook';
import type { RequestTimingSnapshot } from './request-timing';
import { estimateAudioDurationFromBytes } from './egress/openai-audio-driver';

export type AudioBillingParams = {
	modelPricingProfileJson?: string | null;
	routePriceOverrideJson?: string | null;
	/** 计费时长（秒）；预检时可为估算值 */
	durationSeconds: number;
	/** duration 来源 */
	durationSource?: 'upstream' | 'estimated' | 'precheck';
	fileBytes?: number;
	requestStartedAtMs?: number;
};

export type AudioCostBreakdown = {
	durationSeconds: number;
	billableSeconds: number;
	pricePerSecond: number;
	meteredCost: number;
	standardCost: number;
	chargedCost: number;
	meteredFactor: number;
	chargedFactor: number;
	pricingAuditJson: string;
	billingKind: 'audio_per_second';
};

function pricingAtUtcFromParams(requestStartedAtMs?: number): Date {
	const requestedPricingAtUtc =
		typeof requestStartedAtMs === 'number' && Number.isFinite(requestStartedAtMs)
			? new Date(requestStartedAtMs)
			: new Date();
	return Number.isNaN(requestedPricingAtUtc.getTime()) ? new Date() : requestedPricingAtUtc;
}

async function resolveRouteFactors(
	repos: GatewayRepositories,
	routePriceOverrideJson: string | null | undefined,
	requestStartedAtMs?: number
): Promise<{
	meteredFactor: number;
	chargedFactor: number;
	meteredAuditExtras: Pick<PriceResolutionAuditSide, 'base_factor' | 'schedule' | 'effective_factor'>;
	chargedAuditExtras: Pick<PriceResolutionAuditSide, 'base_factor' | 'schedule' | 'effective_factor'>;
}> {
	const pricingAtUtc = pricingAtUtcFromParams(requestStartedAtMs);
	const businessTimezone = await getBusinessTimezone(repos);
	const baseFactors = parseRouteBaseFactors(routePriceOverrideJson ?? null);
	const schedule = parseRoutePricingSchedule(routePriceOverrideJson ?? null);
	const chargedSch = resolveDailyScheduleFactor(schedule.charged, pricingAtUtc, businessTimezone);
	const meteredSch = resolveDailyScheduleFactor(schedule.metered, pricingAtUtc, businessTimezone);
	const meteredFactor = baseFactors.meteredFactor * meteredSch.factor;
	const chargedFactor = baseFactors.chargedFactor * chargedSch.factor;
	const schSide = (sch: typeof chargedSch, base: number, effective: number) => ({
		base_factor: base,
		schedule: {
			timezone: sch.timezone,
			local_time: sch.localTime,
			evaluated_at_utc: sch.evaluatedAtUtc,
			factor: sch.factor,
			window: sch.window
				? { start: sch.window.start, end: sch.window.end, factor: sch.window.factor }
				: null,
		},
		effective_factor: effective,
	});
	return {
		meteredFactor,
		chargedFactor,
		meteredAuditExtras: schSide(meteredSch, baseFactors.meteredFactor, meteredFactor),
		chargedAuditExtras: schSide(chargedSch, baseFactors.chargedFactor, chargedFactor),
	};
}

function buildAudioCosts(
	billing: AudioBillingParams,
	profile: ParsedPricingProfile,
	factors: Awaited<ReturnType<typeof resolveRouteFactors>>
): AudioCostBreakdown {
	const audioCfg = profile.audio!;
	const pricePerSecond = audioCfg.price_per_second;
	const billableSeconds = resolveBillableAudioSeconds(billing.durationSeconds, audioCfg);
	const baseCost = computeAudioPerSecondMeteredCost({
		durationSeconds: billing.durationSeconds,
		pricePerSecond,
		minimumSeconds: audioCfg.minimum_seconds,
	});
	const meteredCost = roundGatewayMoney(baseCost * factors.meteredFactor);
	const standardCost = roundGatewayMoney(baseCost);
	const chargedCost = roundGatewayMoney(baseCost * factors.chargedFactor);
	const pricingAuditJson = JSON.stringify({
		v: PRICING_AUDIT_JSON_SCHEMA_VERSION,
		snapshot: {
			kind: 'audio_per_second',
			duration_seconds: billing.durationSeconds,
			billable_seconds: billableSeconds,
			price_per_second: pricePerSecond,
			minimum_seconds: audioCfg.minimum_seconds ?? 1,
			duration_source: billing.durationSource ?? 'upstream',
			file_bytes: billing.fileBytes ?? null,
			supplier: {
				path: 'profile',
				source: 'model_x_factor',
				...factors.meteredAuditExtras,
			},
			standard: {
				path: 'profile',
				source: 'model',
			},
			user_charge: {
				path: 'profile',
				source: 'model_x_factor',
				...factors.chargedAuditExtras,
			},
		},
	});
	return {
		durationSeconds: billing.durationSeconds,
		billableSeconds,
		pricePerSecond,
		meteredCost,
		standardCost,
		chargedCost,
		meteredFactor: factors.meteredFactor,
		chargedFactor: factors.chargedFactor,
		pricingAuditJson,
		billingKind: 'audio_per_second',
	};
}

function zeroAudioCostBreakdown(
	billing: AudioBillingParams,
	factors: Awaited<ReturnType<typeof resolveRouteFactors>>,
	auditExtra?: Record<string, unknown>
): AudioCostBreakdown {
	return {
		durationSeconds: billing.durationSeconds,
		billableSeconds: 0,
		pricePerSecond: 0,
		meteredCost: 0,
		standardCost: 0,
		chargedCost: 0,
		meteredFactor: factors.meteredFactor,
		chargedFactor: factors.chargedFactor,
		pricingAuditJson: JSON.stringify({
			v: PRICING_AUDIT_JSON_SCHEMA_VERSION,
			snapshot: {
				kind: 'audio_per_second',
				duration_seconds: billing.durationSeconds,
				duration_source: billing.durationSource ?? null,
				file_bytes: billing.fileBytes ?? null,
				...auditExtra,
			},
		}),
		billingKind: 'audio_per_second',
	};
}

/** 按文件大小粗估时长后做预算预检。 */
export async function estimateAudioBudgetPrecheck(
	repos: GatewayRepositories,
	billing: Omit<AudioBillingParams, 'durationSeconds' | 'durationSource'> & { fileBytes: number },
	routePriceOverrides: Array<string | null | undefined>
): Promise<AudioCostBreakdown> {
	const durationSeconds = estimateAudioDurationFromBytes(billing.fileBytes);
	const params: AudioBillingParams = {
		...billing,
		durationSeconds,
		durationSource: 'precheck',
	};
	const profile = parsePricingProfile(billing.modelPricingProfileJson ?? null);
	let maxCharged = 0;
	let best: AudioCostBreakdown | null = null;
	const overrides =
		routePriceOverrides.length > 0 ? routePriceOverrides : [billing.routePriceOverrideJson];
	for (const override of overrides) {
		const factors = await resolveRouteFactors(repos, override, billing.requestStartedAtMs);
		if (!profile || resolveAudioBillingMode(profile) !== 'per_second' || !profileHasAudioPerSecondPricing(profile)) {
			const zero = zeroAudioCostBreakdown(params, factors, { error: 'missing_audio_pricing' });
			if (!best) best = zero;
			continue;
		}
		const costs = buildAudioCosts({ ...params, routePriceOverrideJson: override }, profile, factors);
		if (costs.chargedCost >= maxCharged) {
			maxCharged = costs.chargedCost;
			best = costs;
		}
	}
	return best!;
}

export const canAffordAudioCost = canAffordToolCost;

export type RecordAudioUsageParams = {
	repos: GatewayRepositories;
	apiKeyId: string;
	userId: string;
	userEmail: string | null;
	modelId: string;
	providerId: string;
	providerModelName?: string | null;
	modelName?: string | null;
	providerName?: string | null;
	requestBody?: string | null;
	upstreamRequestBody?: string | null;
	requestProtocol: 'openai';
	upstreamProtocol: UpstreamProtocol;
	routeGroup: string;
	status: 'success' | 'error';
	latencyMs: number;
	errorMessage?: string | null;
	billing: AudioBillingParams;
	providerKeyId?: string | null;
	providerKeyLabel?: string | null;
	providerKeyFingerprint?: string | null;
	upstreamRequestId?: string | null;
	timing?: RequestTimingSnapshot | null;
	circuitEvents?: GatewayCircuitAlertEvent[];
	suppressErrorAlert?: boolean;
};

export async function recordAudioUsage(params: RecordAudioUsageParams): Promise<{
	requestLogId: string;
	chargedCost: number;
}> {
	const profile = parsePricingProfile(params.billing.modelPricingProfileJson ?? null);
	const factors = await resolveRouteFactors(
		params.repos,
		params.billing.routePriceOverrideJson,
		params.billing.requestStartedAtMs
	);

	let costs: AudioCostBreakdown;
	if (params.status === 'error') {
		costs = zeroAudioCostBreakdown(params.billing, factors, { error: 'request_failed' });
	} else if (
		profile &&
		resolveAudioBillingMode(profile) === 'per_second' &&
		profileHasAudioPerSecondPricing(profile)
	) {
		costs = buildAudioCosts(params.billing, profile, factors);
	} else {
		costs = zeroAudioCostBreakdown(params.billing, factors, { error: 'missing_audio_pricing' });
	}

	const chargedCost = params.status === 'error' ? 0 : costs.chargedCost;
	const meteredCost = params.status === 'error' ? 0 : costs.meteredCost;
	const standardCost = params.status === 'error' ? 0 : costs.standardCost;
	const shouldChargeBudget = params.status !== 'error' && chargedCost > 0;
	const id = crypto.randomUUID();
	const userSnapshot = shouldChargeBudget
		? await getUserBudgetSnapshot(params.repos, params.userId)
		: null;
	const beforeSpent = userSnapshot?.budgetSpent ?? 0;
	const userRow = shouldChargeBudget ? await params.repos.users.getById(params.userId) : null;
	const afterSpentVal = roundGatewayMoney(beforeSpent + chargedCost);
	let usageSnaps: { before: string; after: string; changed: string | null } | null = null;
	if (userRow) {
		const beforeS = userRowToSnapshot(userRow);
		const afterS = snapshotWithOverrides(beforeS, { budget_spent: afterSpentVal });
		usageSnaps = {
			before: snapshotToJson(beforeS),
			after: snapshotToJson(afterS),
			changed: changedFieldsToJson(computeChangedFields(beforeS, afterS)),
		};
	}

	const rawUsage =
		params.status === 'success'
			? JSON.stringify({
					billing_kind: costs.billingKind,
					duration_seconds: costs.durationSeconds,
					billable_seconds: costs.billableSeconds,
					duration_source: params.billing.durationSource ?? null,
					file_bytes: params.billing.fileBytes ?? null,
				})
			: null;

	console.log(
		`[Gateway Usage] recordAudioUsage model_id=${params.modelId} status=${params.status} duration=${costs.durationSeconds} billable=${costs.billableSeconds} metered=${meteredCost} standard=${standardCost} charged=${chargedCost}`
	);

	await insertRequestUsageAndChargeTx(params.repos, {
		userId: params.userId,
		requestLog: {
			id,
			userId: params.userId,
			apiKeyId: params.apiKeyId,
			userEmail: params.userEmail,
			modelId: params.modelId,
			providerId: params.providerId,
			providerModelName: params.providerModelName ?? null,
			modelName: params.modelName ?? null,
			providerName: params.providerName ?? null,
			requestBody: params.requestBody ?? null,
			upstreamRequestBody: params.upstreamRequestBody ?? null,
			requestProtocol: params.requestProtocol,
			upstreamProtocol: params.upstreamProtocol,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			reasoningTokens: 0,
			totalTokens: 0,
			meteredCost,
			standardCost,
			chargedCost,
			routeGroup: params.routeGroup,
			status: params.status,
			latencyMs: params.latencyMs,
			gatewayOverheadMs: params.timing?.gatewayOverheadMs ?? null,
			upstreamResponseMs: params.timing?.upstreamResponseMs ?? null,
			finalUpstreamHeadersMs: params.timing?.finalUpstreamHeadersMs ?? null,
			firstReasoningTokenMs: params.timing?.firstReasoningTokenMs ?? null,
			firstTokenMs: params.timing?.firstTokenMs ?? null,
			streamDurationMs: params.timing?.streamDurationMs ?? null,
			upstreamAttemptCount: params.timing?.upstreamAttemptCount ?? null,
			upstreamFailoverCount: params.timing?.upstreamFailoverCount ?? null,
			timingMetadata: params.timing?.timingMetadata ?? null,
			errorMessage: params.errorMessage ?? null,
			rawUsage,
			pricingAudit: costs.pricingAuditJson,
			billingKind: costs.billingKind,
			inputImageCount: 0,
			outputImageCount: 0,
			audioDurationSeconds: params.status === 'success' ? costs.durationSeconds : null,
			providerKeyId: params.providerKeyId ?? null,
			providerKeyLabel: params.providerKeyLabel ?? null,
			providerKeyFingerprint: params.providerKeyFingerprint ?? null,
			upstreamRequestId: params.upstreamRequestId ?? null,
			upstreamMessageId: null,
		},
		shouldChargeBudget,
		beforeSpent,
		chargedCost,
		audit: {
			apiKeyId: params.apiKeyId,
			eventType: 'usage_charge',
			actorType: 'system',
			reasonCode: 'audio_usage_charged_cost',
			reasonText: `Audio charge: ${params.modelId}`,
			beforeSpent,
			beforeBudgetMax: userSnapshot?.budgetMax ?? null,
			afterBudgetMax: userSnapshot?.budgetMax ?? null,
			beforeBudgetPeriod: userSnapshot?.budgetPeriod ?? null,
			afterBudgetPeriod: userSnapshot?.budgetPeriod ?? null,
			beforeBudgetResetAt: userSnapshot?.budgetResetAt ?? null,
			afterBudgetResetAt: userSnapshot?.budgetResetAt ?? null,
			requestLogId: id,
			beforeUserSnapshot: usageSnaps?.before ?? null,
			afterUserSnapshot: usageSnaps?.after ?? null,
			changedFields: usageSnaps?.changed ?? null,
			correlationId: id,
			source: 'gateway_usage',
		},
	});

	if (params.status === 'error' && !params.suppressErrorAlert) {
		await fireGatewayErrorWebhooks(params.repos, {
			requestLogId: id,
			occurredAt: new Date().toISOString(),
			apiKeyId: params.apiKeyId,
			userEmail: params.userEmail,
			modelId: params.modelId,
			modelName: params.modelName ?? null,
			providerId: params.providerId,
			providerName: params.providerName ?? null,
			providerModelName: params.providerModelName ?? null,
			routeGroup: params.routeGroup,
			requestProtocol: params.requestProtocol,
			upstreamProtocol: params.upstreamProtocol,
			errorMessage: params.errorMessage ?? null,
			latencyMs: params.latencyMs,
			providerKeyId: params.providerKeyId ?? null,
			providerKeyLabel: params.providerKeyLabel ?? null,
			providerKeyFingerprint: params.providerKeyFingerprint ?? null,
			upstreamRequestId: params.upstreamRequestId ?? null,
			circuitEvents: params.circuitEvents,
		}).catch((err: unknown) => {
			console.warn(
				'[Gateway Alert] webhook dispatch failed',
				err instanceof Error ? err.stack ?? err.message : err
			);
		});
	}

	return { requestLogId: id, chargedCost };
}
