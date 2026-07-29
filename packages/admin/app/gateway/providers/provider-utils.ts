import type { GatewayProvider } from '@/lib/types';
import {
	listConfiguredCapabilities,
	parseProviderEndpoints,
	resolveUpstreamEndpoint,
	serializeProviderEndpoints,
	type ProviderEndpointCapability,
	type ProviderEndpointsMap,
	type ProtocolEndpointsConfig,
} from '@octafuse/core/provider-endpoints';
import type { UpstreamProtocol } from '@octafuse/core/upstream-protocol';
import type {
	ProtocolEndpointForm,
	ProviderCapabilityBadge,
	ProviderFormData,
	ProviderProtocolSummary,
} from './types';
import { EMPTY_PROTOCOL_FORM } from './types';

/** 完整 capability → 卡片紧凑标签（OpenAI images.* → images；audio.transcriptions → audio）。 */
export function capabilityDisplayBadges(
	capabilities: readonly ProviderEndpointCapability[]
): ProviderCapabilityBadge[] {
	const badges: ProviderCapabilityBadge[] = [];
	const set = new Set(capabilities);
	if (set.has('chat')) badges.push('chat');
	if (set.has('images.generations') || set.has('images.edits')) badges.push('images');
	if (set.has('audio.transcriptions')) badges.push('audio');
	if (set.has('messages')) badges.push('messages');
	if (set.has('generateContent')) badges.push('generateContent');
	if (set.has('streamGenerateContent')) badges.push('streamGenerateContent');
	return badges;
}

function protocolFormFromConfig(cfg: ProtocolEndpointsConfig | undefined): ProtocolEndpointForm {
	const form: ProtocolEndpointForm = { ...EMPTY_PROTOCOL_FORM };
	if (!cfg) return form;
	form.base = cfg.base ?? '';
	const eps = cfg.endpoints ?? {};
	form.chat = eps.chat ?? '';
	form.images_generations = eps['images.generations'] ?? '';
	form.images_edits = eps['images.edits'] ?? '';
	form.audio_transcriptions = eps['audio.transcriptions'] ?? '';
	form.messages = eps.messages ?? '';
	form.generateContent = eps.generateContent ?? '';
	form.streamGenerateContent = eps.streamGenerateContent ?? '';
	return form;
}

/** Provider 行 → 弹窗表单（endpoints + status；api_key 留空表示不改）。 */
export function providerToFormData(
	provider: GatewayProvider
): Omit<ProviderFormData, 'id' | 'name' | 'description'> {
	const map = parseProviderEndpoints(provider);
	return {
		api_key: '',
		status: provider.status === 'disabled' ? 'disabled' : 'active',
		openai: protocolFormFromConfig(map.openai),
		anthropic: protocolFormFromConfig(map.anthropic),
		gemini: protocolFormFromConfig(map.gemini),
	};
}

function configFromProtocolForm(
	protocol: 'openai' | 'anthropic' | 'gemini',
	form: ProtocolEndpointForm
): ProtocolEndpointsConfig | undefined {
	const base = form.base.trim();
	const endpoints: NonNullable<ProtocolEndpointsConfig['endpoints']> = {};
	if (protocol === 'openai') {
		if (form.chat.trim()) endpoints.chat = form.chat.trim();
		if (form.images_generations.trim()) endpoints['images.generations'] = form.images_generations.trim();
		if (form.images_edits.trim()) endpoints['images.edits'] = form.images_edits.trim();
		if (form.audio_transcriptions.trim()) {
			endpoints['audio.transcriptions'] = form.audio_transcriptions.trim();
		}
	} else if (protocol === 'anthropic') {
		if (form.messages.trim()) endpoints.messages = form.messages.trim();
	} else {
		if (form.generateContent.trim()) endpoints.generateContent = form.generateContent.trim();
		if (form.streamGenerateContent.trim()) {
			endpoints.streamGenerateContent = form.streamGenerateContent.trim();
		}
	}
	if (!base && Object.keys(endpoints).length === 0) return undefined;
	const cfg: ProtocolEndpointsConfig = {};
	if (base) cfg.base = base;
	if (Object.keys(endpoints).length > 0) cfg.endpoints = endpoints;
	return cfg;
}

/** 表单 → API `endpoints` 对象。 */
export function formDataToEndpointsMap(form: ProviderFormData): ProviderEndpointsMap {
	const map: ProviderEndpointsMap = {};
	const openai = configFromProtocolForm('openai', form.openai);
	const anthropic = configFromProtocolForm('anthropic', form.anthropic);
	const gemini = configFromProtocolForm('gemini', form.gemini);
	if (openai) map.openai = openai;
	if (anthropic) map.anthropic = anthropic;
	if (gemini) map.gemini = gemini;
	return map;
}

export function formDataToEndpointsJson(form: ProviderFormData): string | null {
	return serializeProviderEndpoints(formDataToEndpointsMap(form));
}

export function getProviderProtocolSummaries(provider: GatewayProvider): ProviderProtocolSummary[] {
	const map = parseProviderEndpoints(provider);
	const rows: ProviderProtocolSummary[] = [];

	const appendProtocol = (
		key: UpstreamProtocol,
		label: string
	) => {
		const config = map[key];
		if (!config) return;
		const capabilities = listConfiguredCapabilities(map, key);
		if (capabilities.length === 0) return;
		const endpoints = capabilities.flatMap((capability) => {
			try {
				const resolved = resolveUpstreamEndpoint(key, capability, map, {
					model: '{model}',
					providerId: provider.id,
				}).replace(/%7Bmodel%7D/gi, '{model}');
				return [{
					capability,
					url: resolved,
					source: config.endpoints?.[capability] ? 'override' as const : 'base' as const,
				}];
			} catch {
				return [];
			}
		});
		if (endpoints.length === 0) return;
		rows.push({
			key,
			label,
			baseUrl: config.base ?? null,
			overrideCount: Object.keys(config.endpoints ?? {}).length,
			capabilities,
			badges: capabilityDisplayBadges(capabilities),
			endpoints,
		});
	};

	appendProtocol('openai', 'OpenAI');
	appendProtocol('anthropic', 'Anthropic');
	appendProtocol('gemini', 'Gemini');
	return rows;
}

export function suggestDuplicateProviderId(sourceId: string, existingIds: Set<string>): string {
	const base = `${sourceId}-copy`;
	if (!existingIds.has(base)) return base;
	for (let n = 2; n < 1000; n++) {
		const candidate = `${base}-${n}`;
		if (!existingIds.has(candidate)) return candidate;
	}
	return '';
}

/** 某协议 Advanced 区是否有任意覆盖（用于默认展开）。 */
export function protocolFormHasOverrides(
	protocol: 'openai' | 'anthropic' | 'gemini',
	form: ProtocolEndpointForm
): boolean {
	if (protocol === 'openai') {
		return !!(
			form.chat.trim() ||
			form.images_generations.trim() ||
			form.images_edits.trim() ||
			form.audio_transcriptions.trim()
		);
	}
	if (protocol === 'anthropic') return !!form.messages.trim();
	return !!(form.generateContent.trim() || form.streamGenerateContent.trim());
}
