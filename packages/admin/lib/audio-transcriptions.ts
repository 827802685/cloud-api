/**
 * Shared helpers for Admin Playground / Simulator / Routes
 * (`/v1/audio/transcriptions` multipart).
 */
import { isAudioTranscriptionModel, type ModelKindFields } from '@octafuse/core/db/model-modalities';
import { parsePricingProfile } from '@octafuse/core/db/pricing-profile';

/** Align with Proxy audio driver limits (admin must not depend on `@octafuse/proxy`). */
export const AUDIO_MAX_BYTES_PER_FILE = 25 * 1024 * 1024;

/** Default JSON fields for transcriptions (audio file uploaded separately as multipart). */
export const AUDIO_TRANSCRIPTIONS_BODY_TEMPLATE = `{
  "model": "<auto>",
  "language": "",
  "response_format": "json"
}`;

export function isAudioRouteModel(m: ModelKindFields): boolean {
	return isAudioTranscriptionModel(m);
}

/** Validate audio file before send (Playground / Simulator). */
export function validateAudioTranscriptionFile(
	file: File | null | undefined
): { ok: true } | { ok: false; error: string } {
	if (!file) {
		return { ok: false, error: 'An audio file is required' };
	}
	if (file.size > AUDIO_MAX_BYTES_PER_FILE) {
		return {
			ok: false,
			error: `audio file must be at most ${AUDIO_MAX_BYTES_PER_FILE} bytes`,
		};
	}
	return { ok: true };
}

/** Catalog model → 只读按秒单价摘要（Routes 弹窗）。 */
export function getCatalogAudioPricingDisplay(
	model: { pricing_profile?: string | null } | null | undefined,
	currencyCode = 'USD'
): { pricePerSecond: string; minimumSeconds: string; unit: string } | null {
	if (!model?.pricing_profile?.trim()) return null;
	const p = parsePricingProfile(model.pricing_profile);
	if (!p?.audio || p.audio_billing_mode !== 'per_second') return null;
	const unit = currencyCode.toUpperCase() === 'CNY' ? '¥/s' : '$/s';
	return {
		pricePerSecond: String(p.audio.price_per_second),
		minimumSeconds: String(p.audio.minimum_seconds ?? 1),
		unit,
	};
}
