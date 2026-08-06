import type { UpstreamProtocol } from './upstream-protocol';

/** Gemini generate-content family (stream + non-stream). */
export const GEMINI_GENERATE_OPERATION = 'models.generate';

/** Legacy Gemini wire-action operation names (pre-v2.2.0). */
export const GEMINI_LEGACY_GENERATE_OPERATIONS = [
	'generateContent',
	'streamGenerateContent',
] as const;

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
	gemini: [GEMINI_GENERATE_OPERATION],
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

/**
 * Map legacy Gemini operations to the canonical family; non-gemini / unknown values (incl. `*`) pass through.
 */
export function canonicalizeRequestOperation(protocol: string, operation: string): string {
	const op = operation.trim();
	if (protocol.trim().toLowerCase() !== 'gemini') return op;
	if (
		op === GEMINI_GENERATE_OPERATION ||
		(GEMINI_LEGACY_GENERATE_OPERATIONS as readonly string[]).includes(op)
	) {
		return GEMINI_GENERATE_OPERATION;
	}
	return op;
}

/**
 * Alias priority when multiple legacy keys collapse to the same canonical key:
 * `models.generate` (2) > `generateContent` (1) > `streamGenerateContent` (0); others -1.
 * Comparison is case-insensitive.
 */
export function requestOperationAliasRank(operation: string): number {
	const op = operation.trim().toLowerCase();
	if (op === GEMINI_GENERATE_OPERATION.toLowerCase()) return 2;
	if (op === 'generatecontent') return 1;
	if (op === 'streamgeneratecontent') return 0;
	return -1;
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
