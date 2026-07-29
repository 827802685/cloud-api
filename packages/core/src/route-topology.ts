import type { UpstreamProtocol } from './upstream-protocol';

/** Stable request-operation identifiers. `*` is reserved for migrated legacy surfaces/targets. */
export const REQUEST_OPERATIONS_BY_PROTOCOL = {
	openai: [
		'chat',
		'responses',
		'images.generations',
		'images.edits',
		'audio.transcriptions',
	],
	anthropic: ['messages'],
	gemini: ['generateContent', 'streamGenerateContent'],
} as const satisfies Record<UpstreamProtocol, readonly string[]>;

export type RequestOperation =
	| (typeof REQUEST_OPERATIONS_BY_PROTOCOL)[UpstreamProtocol][number]
	| '*';

export const LEGACY_WILDCARD_OPERATION: RequestOperation = '*';
export const PASSTHROUGH_ROUTE_ADAPTER = 'passthrough';

export function isRequestOperationForProtocol(
	protocol: UpstreamProtocol,
	operation: string
): boolean {
	return (
		operation === LEGACY_WILDCARD_OPERATION ||
		(REQUEST_OPERATIONS_BY_PROTOCOL[protocol] as readonly string[]).includes(operation)
	);
}

export function normalizeRouteOperation(raw: unknown): string {
	const operation = typeof raw === 'string' ? raw.trim() : '';
	return operation || LEGACY_WILDCARD_OPERATION;
}

export function effectiveUpstreamOperation(
	configuredOperation: string | null | undefined,
	requestOperation: string
): string {
	const configured = normalizeRouteOperation(configuredOperation);
	return configured === LEGACY_WILDCARD_OPERATION ? requestOperation : configured;
}

export interface RoutePoolRow {
	id: string;
	model_id: string;
	route_group: string;
	name: string;
	strategy: string | null;
	status: string;
	created_at?: string;
	updated_at?: string;
}

export interface ModelSurfaceRow {
	id: string;
	model_id: string;
	route_group: string;
	request_protocol: string;
	request_operation: string;
	route_pool_id: string;
	status: string;
	created_at?: string;
	updated_at?: string;
}

export type ResolvedModelSurfaceRow = ModelSurfaceRow & {
	pool_name: string;
	pool_strategy: string | null;
	pool_status: string;
};
