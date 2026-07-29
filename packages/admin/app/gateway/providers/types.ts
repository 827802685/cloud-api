import type { GatewayProvider } from '@/lib/types';
import type {
	ProviderEndpointCapability,
	ProviderEndpointsMap,
} from '@octafuse/core/provider-endpoints';

/** 卡片上紧凑展示的能力标签（OpenAI images.* 合并为 images；audio.transcriptions → audio）。 */
export type ProviderCapabilityBadge =
	| 'chat'
	| 'images'
	| 'audio'
	| 'messages'
	| 'generateContent'
	| 'streamGenerateContent';

/** `GET /admin/providers/import/catalog` */
export type ProviderImportCatalogRow = {
	id: string;
	name: string;
	vendor_key: string;
	icon_key: string;
	vendor_label: string;
	protocols: Array<'openai' | 'anthropic' | 'gemini'>;
	endpoints: string | null;
	description: string | null;
};

export type ProviderProtocolSummary = {
	key: 'openai' | 'anthropic' | 'gemini';
	label: string;
	url: string;
	/** 与 runtime 一致的已配置 capability（完整 key）。 */
	capabilities: ProviderEndpointCapability[];
	/** 卡片紧凑标签（images.* → images）。 */
	badges: ProviderCapabilityBadge[];
};

/** 单协议表单：base + Advanced capability 覆盖 */
export type ProtocolEndpointForm = {
	base: string;
	chat: string;
	images_generations: string;
	images_edits: string;
	audio_transcriptions: string;
	messages: string;
	generateContent: string;
	streamGenerateContent: string;
};

export type ProviderFormData = {
	id: string;
	name: string;
	/** 创建必填；编辑时空 = 不改 */
	api_key: string;
	/** `active` | `disabled` */
	status: 'active' | 'disabled';
	openai: ProtocolEndpointForm;
	anthropic: ProtocolEndpointForm;
	gemini: ProtocolEndpointForm;
	description: string;
};

export type ProviderImportResult = {
	created: number;
	failed: Array<{ id: string; message: string }>;
};

export const EMPTY_PROTOCOL_FORM: ProtocolEndpointForm = {
	base: '',
	chat: '',
	images_generations: '',
	images_edits: '',
	audio_transcriptions: '',
	messages: '',
	generateContent: '',
	streamGenerateContent: '',
};

export const EMPTY_PROVIDER_FORM: ProviderFormData = {
	id: '',
	name: '',
	api_key: '',
	status: 'active',
	openai: { ...EMPTY_PROTOCOL_FORM },
	anthropic: { ...EMPTY_PROTOCOL_FORM },
	gemini: { ...EMPTY_PROTOCOL_FORM },
	description: '',
};

export type { GatewayProvider, ProviderEndpointsMap };
