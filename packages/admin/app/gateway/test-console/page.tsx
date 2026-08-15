'use client';

/**
 * Test Console：以模型为中心的快速测试页面，支持多模型同时测试与对比。
 * 支持三类模型：
 * - LLM：流式文本聊天（openai / anthropic / gemini）
 * - 文生图：images.generations（JSON）/ images.edits（multipart 参考图）
 * - 音频转写：audio.transcriptions（multipart 音频文件）
 * 复用现有 playground 后端 API（不计费、不写日志），前端自动解析 model → route。
 */
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { flushSync } from 'react-dom';
import {
	PaperAirplaneIcon,
	ClipboardDocumentIcon,
	StopIcon,
} from '@heroicons/react/24/outline';
import { readApiJson } from '@/lib/api-json';
import { ProgressBar } from '@/components/progress-bar';
import {
	mergeAssistantTextParts,
	type PlaygroundProtocol,
	type PlaygroundResponseParseMode,
} from '@/lib/playground/merge-assistant-text';
import { parseLastStreamUsage, tryParseUsageSummary } from '@/lib/playground/usage-parsing';
import type { AdminModelRow } from '@/lib/services/admin/types';
import type { GatewayProvider } from '@/lib/types';
import { isImageGenerationModel, isAudioTranscriptionModel } from '@cloud-api/core/db/model-modalities';
import { ModelVendorIcon } from '@/components/model-vendor-icon';
import { ImageGenerationsPreview } from '@/components/image-generations-preview';
import {
	IMAGE_MAX_REFERENCE_COUNT,
	imageRequestMetaFromBody,
	parseImagesGenerationsResponse,
	readFileAsDataUrl,
	validateEditImageFiles,
	type ImageOperation,
	type ImagePreviewItem,
} from '@/lib/image-generations';
import { validateAudioTranscriptionFile } from '@/lib/audio-transcriptions';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type RouteRow = {
	id: string;
	model_id: string;
	provider_id: string;
	provider_model_name: string;
	priority: number;
	status: string;
	upstream_protocol: string;
	route_group: string;
	model_name: string | null;
	provider_name: string | null;
};

/** 模型能力类型：LLM / 文生图 / 音频转写 */
type ModelKind = 'llm' | 'image' | 'audio';
type KindFilter = 'all' | ModelKind;

type ModelOption = {
	id: string;
	display_name: string | null;
	vendor: string;
	kind: ModelKind;
	/** 模型是否被禁用（没有任何 active 路由）。禁用后 auto 模式不会使用。 */
	disabled: boolean;
};

type TestResult = {
	modelId: string;
	modelName: string;
	providerName: string;
	routeId: string;
	protocol: PlaygroundProtocol;
	kind: ModelKind;
	status: 'pending' | 'streaming' | 'done' | 'error';
	responseText: string;
	reasoningText: string;
	bodyText: string;
	httpStatus: number | null;
	latencyMs: number | null;
	usageHint: string | null;
	errorMessage: string | null;
	imagePreviews: ImagePreviewItem[];
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_PROMPT = 'hi';

const KIND_FILTERS: Array<{ id: KindFilter; labelKey: string }> = [
	{ id: 'all', labelKey: 'kindAll' },
	{ id: 'llm', labelKey: 'kindLlm' },
	{ id: 'image', labelKey: 'kindImage' },
	{ id: 'audio', labelKey: 'kindAudio' },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function modelKindOf(m: AdminModelRow): ModelKind {
	if (isAudioTranscriptionModel(m)) return 'audio';
	if (isImageGenerationModel(m)) return 'image';
	return 'llm';
}

function pickBestRoute(modelId: string, routes: RouteRow[]): RouteRow | null {
	const modelRoutes = routes
		.filter((r) => r.model_id === modelId && r.status === 'active')
		.sort((a, b) => b.priority - a.priority);
	return modelRoutes[0] ?? null;
}

function buildChatBody(prompt: string, protocol: PlaygroundProtocol): Record<string, unknown> {
	if (protocol === 'anthropic') {
		return {
			messages: [{ role: 'user', content: prompt }],
			max_tokens: 1024,
			stream: true,
		};
	}
	if (protocol === 'gemini') {
		return {
			contents: [{ role: 'user', parts: [{ text: prompt }] }],
		};
	}
	// openai (default)
	return {
		messages: [{ role: 'user', content: prompt }],
		max_tokens: 1024,
		stream: true,
		stream_options: { include_usage: true },
	};
}

function buildImageBody(
	prompt: string,
	imageOperation: ImageOperation,
	editImageDataUrls: string[],
	protocol?: PlaygroundProtocol
): Record<string, unknown> {
	if (protocol === 'gemini') {
		return { prompt, contents: [{ role: 'user', parts: [{ text: prompt }] }], imageOperation };
	}
	if (imageOperation === 'edits') {
		return { prompt, image: editImageDataUrls };
	}
	return { prompt, n: 1, size: '1024x1024', quality: 'low' };
}

function buildAudioBody(audioFileDataUrl: string): Record<string, unknown> {
	return { file: audioFileDataUrl, language: '', response_format: 'json' };
}

/** 从音频转写 JSON 响应中提取 `text` 字段（无则返回 null）。 */
function extractAudioTranscriptionText(jsonText: string): string | null {
	try {
		const j = JSON.parse(jsonText) as Record<string, unknown>;
		if (j && typeof j === 'object' && typeof j.text === 'string' && j.text.trim()) {
			return j.text;
		}
	} catch {
		// ignore
	}
	return null;
}

/* ------------------------------------------------------------------ */
/*  Components                                                         */
/* ------------------------------------------------------------------ */

function ModelChip(props: {
	model: ModelOption;
	selected: boolean;
	onToggle: () => void;
	t: (key: string) => string;
}) {
	const { model, selected, onToggle, t } = props;
	const displayName = model.display_name || model.id;
	const kindLabel = t(`kind_${model.kind}`);
	return (
		<button
			type="button"
			onClick={onToggle}
			title={model.disabled ? '已禁用（点击可选中后批量启用）' : undefined}
			className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
				model.disabled
					? 'border-gray-100 bg-gray-50 text-gray-400 hover:border-gray-200'
					: selected
						? 'border-blue-500 bg-blue-50 text-blue-900 ring-1 ring-blue-500'
						: 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
			}`}
		>
			<span
				className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
					selected
						? 'border-blue-500 bg-blue-500'
						: model.disabled
							? 'border-gray-300 bg-gray-100'
							: 'border-gray-300 bg-white'
				}`}
			>
				{selected && (
					<svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
						<path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
					</svg>
				)}
			</span>
			<ModelVendorIcon vendor={model.vendor} size="compact" />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<span className="truncate font-medium">{displayName}</span>
					<span
						className={`shrink-0 rounded px-1 py-px text-[10px] font-medium ${
							model.kind === 'image'
								? 'bg-purple-100 text-purple-700'
								: model.kind === 'audio'
									? 'bg-teal-100 text-teal-700'
									: 'bg-blue-100 text-blue-700'
						}`}
					>
						{kindLabel}
					</span>
				</div>
				<div className="truncate font-mono text-[11px] text-gray-500">{model.id}</div>
			</div>
		</button>
	);
}

function ResultCard(props: {
	result: TestResult;
	selected: boolean;
	onToggleSelect: () => void;
	t: (key: string) => string;
}) {
	const { result, selected, onToggleSelect, t } = props;
	const isPending = result.status === 'pending' || result.status === 'streaming';
	const hasImagePreviews = result.imagePreviews.length > 0;

	return (
		<div className={`flex flex-col rounded-lg border ${
			result.status === 'error'
				? 'border-red-200 bg-red-50/30'
				: result.status === 'done'
					? 'border-green-200 bg-white'
					: 'border-gray-200 bg-white'
		}`}>
			{/* Header */}
			<div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
				<button
					type="button"
					onClick={onToggleSelect}
					title={selected ? t('deselectModel') : t('selectModel')}
					className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
						selected
							? 'border-blue-500 bg-blue-500'
							: 'border-gray-300 bg-white hover:border-gray-400'
					}`}
				>
					{selected && (
						<svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
							<path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
						</svg>
					)}
				</button>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<span className="truncate text-sm font-semibold text-gray-900">{result.modelName}</span>
						<span
							className={`shrink-0 rounded px-1 py-px text-[10px] font-medium ${
								result.kind === 'image'
									? 'bg-purple-100 text-purple-700'
									: result.kind === 'audio'
										? 'bg-teal-100 text-teal-700'
										: 'bg-blue-100 text-blue-700'
							}`}
						>
							{t(`kind_${result.kind}`)}
						</span>
					</div>
					<div className="truncate text-[11px] text-gray-500">
						{result.providerName} · {result.protocol}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1.5 text-xs">
					{result.httpStatus != null && (
						<span className={`rounded-full px-2 py-0.5 font-medium ${
							result.httpStatus >= 200 && result.httpStatus < 300
								? 'bg-green-100 text-green-800'
								: 'bg-red-100 text-red-800'
						}`}>
							{result.httpStatus}
						</span>
					)}
					{result.latencyMs != null && (
						<span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">
							{result.latencyMs}ms
						</span>
					)}
					{isPending && (
						<span className="inline-flex items-center gap-1 text-blue-600">
							<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
							{result.status === 'pending' ? t('pending') : t('streaming')}
						</span>
					)}
				</div>
			</div>

			{/* Body */}
			<div className="flex-1 overflow-auto px-4 py-3">
				{result.status === 'error' ? (
					<div className="text-sm text-red-600">{result.errorMessage}</div>
				) : hasImagePreviews ? (
					<ImageGenerationsPreview images={result.imagePreviews} label={t('imagePreview')} />
				) : result.responseText || result.reasoningText ? (
					<div className="space-y-2">
						{result.reasoningText && (
							<div>
								<div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
									{t('thinking')}
								</div>
								<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-amber-50/60 p-2 font-mono text-xs text-gray-800">
									{result.reasoningText}
								</pre>
							</div>
						)}
						<div>
							<pre className="whitespace-pre-wrap break-words font-mono text-sm text-gray-900">
								{result.bodyText || result.responseText}
							</pre>
						</div>
					</div>
				) : isPending ? (
					<div className="flex items-center gap-2 text-sm text-gray-400">
						<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
						{t('waitingForResponse')}
					</div>
				) : (
					<div className="text-sm text-gray-400">{t('noResponse')}</div>
				)}
			</div>

			{/* Footer */}
			{result.usageHint && (
				<div className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-500">
					{t('usage')}: {result.usageHint}
				</div>
			)}
		</div>
	);
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

function TestConsolePageInner() {
	const t = useTranslations('testConsole');
	const tCommon = useTranslations('common');

	/* Data loading */
	const [routes, setRoutes] = useState<RouteRow[]>([]);
	const [models, setModels] = useState<AdminModelRow[]>([]);
	const [providers, setProviders] = useState<Map<string, GatewayProvider>>(new Map());
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);

	/* Test state */
	const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
	const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set());
	const [results, setResults] = useState<Map<string, TestResult>>(new Map());
	const [isRunning, setIsRunning] = useState(false);
	const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
	const [filterText, setFilterText] = useState('');
	const [kindFilter, setKindFilter] = useState<KindFilter>('all');

	/* Image / audio request state */
	const [imageOperation, setImageOperation] = useState<ImageOperation>('generations');
	const [editFiles, setEditFiles] = useState<File[]>([]);
	const [audioFile, setAudioFile] = useState<File | null>(null);

	const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

	/* Build model options (all kinds with routes; disabled models shown grayed out) */
	const modelOptions = useMemo<ModelOption[]>(() => {
		const modelsWithRoutes = new Set<string>();
		for (const r of routes) {
			if (r.status === 'active') {
				modelsWithRoutes.add(r.model_id);
			}
		}
		// 有任意路由（含 disabled）的模型都展示，便于在试玩台直接启用/禁用
		const modelsWithAnyRoute = new Set<string>();
		for (const r of routes) {
			modelsWithAnyRoute.add(r.model_id);
		}
		return models
			.filter((m) => modelsWithAnyRoute.has(m.id))
			.map((m) => ({
				id: m.id,
				display_name: m.display_name,
				vendor: m.vendor,
				kind: modelKindOf(m),
				disabled: !modelsWithRoutes.has(m.id),
			}))
			.sort((a, b) => (a.display_name || a.id).localeCompare(b.display_name || b.id));
	}, [models, routes]);

	const kindCounts = useMemo(() => {
		const counts: Record<ModelKind, number> = { llm: 0, image: 0, audio: 0 };
		for (const m of modelOptions) {
			counts[m.kind] += 1;
		}
		return counts;
	}, [modelOptions]);

	const filteredModelOptions = useMemo(() => {
		const q = filterText.trim().toLowerCase();
		return modelOptions.filter((m) => {
			if (kindFilter !== 'all' && m.kind !== kindFilter) return false;
			if (!q) return true;
			return (
				m.id.toLowerCase().includes(q) ||
				(m.display_name ?? '').toLowerCase().includes(q) ||
				m.vendor.toLowerCase().includes(q)
			);
		});
	}, [modelOptions, filterText, kindFilter]);

	/* Load data */
	useEffect(() => {
		let cancelled = false;
		(async () => {
			setLoading(true);
			setLoadError(null);
			try {
				const [rRes, mRes, pRes] = await Promise.all([
					fetch('/api/admin/routes'),
					fetch('/api/admin/models'),
					fetch('/api/admin/providers'),
				]);
				const routesData = await readApiJson<RouteRow[]>(rRes);
				const modelsData = await readApiJson<AdminModelRow[]>(mRes);
				const providersData = await readApiJson<GatewayProvider[]>(pRes);
				if (cancelled) return;
				if (routesData.success && Array.isArray(routesData.data)) {
					setRoutes(routesData.data);
				} else {
					setLoadError(routesData.message ?? tCommon('failedToLoadRoutes'));
				}
				if (modelsData.success && Array.isArray(modelsData.data)) {
					setModels(modelsData.data);
				}
				if (providersData.success && Array.isArray(providersData.data)) {
					setProviders(new Map(providersData.data.map((p) => [p.id, p])));
				}
			} catch (e) {
				if (!cancelled) setLoadError(e instanceof Error ? e.message : tCommon('failedToLoadRoutes'));
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, [tCommon]);

	/* Selection handlers */
	const toggleModel = useCallback((id: string) => {
		setSelectedModelIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const selectAll = useCallback(() => {
		setSelectedModelIds(new Set(filteredModelOptions.filter((m) => !m.disabled).map((m) => m.id)));
	}, [filteredModelOptions]);

	const clearSelection = useCallback(() => {
		setSelectedModelIds(new Set());
	}, []);

	/* 批量启用/禁用模型：禁用 = 把该模型所有 active 路由置为 disabled（auto 模式不再使用） */
	const [statusBusy, setStatusBusy] = useState(false);
	const [statusError, setStatusError] = useState<string | null>(null);

	const setModelsStatus = useCallback(
		async (modelIds: string[], status: 'active' | 'disabled') => {
			if (modelIds.length === 0) return;
			setStatusBusy(true);
			setStatusError(null);
			try {
				const routeIds: string[] = [];
				for (const r of routes) {
					if (modelIds.includes(r.model_id)) {
						if (status === 'disabled' && r.status === 'active') routeIds.push(r.id);
						if (status === 'active' && r.status === 'disabled') routeIds.push(r.id);
					}
				}
				if (routeIds.length === 0) return;
				const res = await fetch('/api/admin/routes/batch-status', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ ids: routeIds, status }),
				});
				const data = await readApiJson<{ changes: number }>(res);
				if (!data.success) {
					setStatusError(data.message || 'Failed to update model status');
					return;
				}
				// 刷新路由状态
				const rRes = await fetch('/api/admin/routes');
				const routesData = await readApiJson<RouteRow[]>(rRes);
				if (routesData.success && Array.isArray(routesData.data)) {
					setRoutes(routesData.data);
				}
				// 被禁用的模型从选中集合移除
				if (status === 'disabled') {
					setSelectedModelIds((prev) => {
						const next = new Set(prev);
						for (const id of modelIds) next.delete(id);
						return next;
					});
				}
			} catch (e) {
				setStatusError(e instanceof Error ? e.message : 'Failed to update model status');
			} finally {
				setStatusBusy(false);
			}
		},
		[routes]
	);

	const disableSelected = useCallback(() => {
		void setModelsStatus([...selectedModelIds], 'disabled');
	}, [selectedModelIds, setModelsStatus]);

	const hasDisabledSelected = useMemo(
		() => modelOptions.some((m) => m.disabled && selectedModelIds.has(m.id)),
		[modelOptions, selectedModelIds]
	);

	const enableSelected = useCallback(() => {
		const disabledSelected = modelOptions
			.filter((m) => m.disabled && selectedModelIds.has(m.id))
			.map((m) => m.id);
		void setModelsStatus(disabledSelected, 'active');
	}, [modelOptions, selectedModelIds, setModelsStatus]);

	/* Send test to a single model */
	const sendToModel = useCallback(
		async (
			modelId: string,
			modelName: string,
			route: RouteRow,
			kind: ModelKind,
			signal: AbortSignal
		) => {
			const protocol = (route.upstream_protocol || 'openai') as PlaygroundProtocol;
			const providerName = route.provider_name || route.provider_id;

			// Build kind-specific request body
			let body: Record<string, unknown>;
			let imageOperationForRequest: ImageOperation | undefined;
			try {
				if (kind === 'audio') {
					if (!audioFile) return;
					const validated = validateAudioTranscriptionFile(audioFile);
					if (!validated.ok) {
						setResults((prev) => {
							const next = new Map(prev);
							next.set(modelId, {
								modelId,
								modelName,
								providerName,
								routeId: route.id,
								protocol,
								kind,
								status: 'error',
								responseText: '',
								reasoningText: '',
								bodyText: '',
								httpStatus: null,
								latencyMs: null,
								usageHint: null,
								errorMessage: validated.error,
								imagePreviews: [],
							});
							return next;
						});
						return;
					}
					const dataUrl = await readFileAsDataUrl(audioFile);
					body = buildAudioBody(dataUrl);
				} else if (kind === 'image') {
					if (imageOperation === 'edits') {
						const validated = validateEditImageFiles(editFiles);
						if (!validated.ok) {
							setResults((prev) => {
								const next = new Map(prev);
								next.set(modelId, {
									modelId,
									modelName,
									providerName,
									routeId: route.id,
									protocol,
									kind,
									status: 'error',
									responseText: '',
									reasoningText: '',
									bodyText: '',
									httpStatus: null,
									latencyMs: null,
									usageHint: null,
									errorMessage: validated.error,
									imagePreviews: [],
								});
								return next;
							});
							return;
						}
						const dataUrls = await Promise.all(editFiles.map((f) => readFileAsDataUrl(f)));
						body = buildImageBody(prompt, 'edits', dataUrls, protocol);
					} else {
						body = buildImageBody(prompt, 'generations', [], protocol);
					}
					imageOperationForRequest = imageOperation;
				} else {
					body = buildChatBody(prompt, protocol);
				}
			} catch (e) {
				setResults((prev) => {
					const next = new Map(prev);
					next.set(modelId, {
						modelId,
						modelName,
						providerName,
						routeId: route.id,
						protocol,
						kind,
						status: 'error',
						responseText: '',
						reasoningText: '',
						bodyText: '',
						httpStatus: null,
						latencyMs: null,
						usageHint: null,
						errorMessage: e instanceof Error ? e.message : String(e),
						imagePreviews: [],
					});
					return next;
				});
				return;
			}

			// Initialize result
			const initResult: TestResult = {
				modelId,
				modelName,
				providerName,
				routeId: route.id,
				protocol,
				kind,
				status: 'pending',
				responseText: '',
				reasoningText: '',
				bodyText: '',
				httpStatus: null,
				latencyMs: null,
				usageHint: null,
				errorMessage: null,
				imagePreviews: [],
			};

			setResults((prev) => {
				const next = new Map(prev);
				next.set(modelId, { ...initResult });
				return next;
			});

			const payload: Record<string, unknown> = { routeId: route.id, body };
			if (imageOperationForRequest) payload.imageOperation = imageOperationForRequest;

			try {
				const res = await fetch('/api/admin/playground', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
					signal,
				});

				const latencyHeader = res.headers.get('x-playground-latency-ms');
				const latencyMs = latencyHeader ? parseInt(latencyHeader, 10) : null;
				const ct = res.headers.get('Content-Type') ?? '';

				setResults((prev) => {
					const next = new Map(prev);
					const existing = next.get(modelId);
					if (existing) {
						existing.httpStatus = res.status;
						existing.latencyMs = latencyMs;
						existing.status = 'streaming';
					}
					return next;
				});

				// Handle JSON response (success or error)
				if (ct.includes('application/json') && !ct.includes('text/event-stream')) {
					const j = (await res.json()) as Record<string, unknown>;
					const jsonText = JSON.stringify(j, null, 2);
					if (!res.ok) {
						const errObj = j.error;
						let errMsg = String(j.message ?? '');
						if (!errMsg && typeof errObj === 'string') errMsg = errObj;
						if (!errMsg && errObj && typeof errObj === 'object' && 'message' in errObj) {
							errMsg = String((errObj as Record<string, unknown>).message ?? '');
						}
						setResults((prev) => {
							const next = new Map(prev);
							const existing = next.get(modelId);
							if (existing) {
								existing.status = 'error';
								existing.responseText = jsonText;
								existing.errorMessage = errMsg || 'Request failed';
							}
							return next;
						});
						return;
					}
					// Success JSON
					if (kind === 'image') {
						const parsedImg = parseImagesGenerationsResponse(
							jsonText,
							imageRequestMetaFromBody(body)
						);
						setResults((prev) => {
							const next = new Map(prev);
							const existing = next.get(modelId);
							if (existing) {
								existing.status = 'done';
								existing.responseText = jsonText;
								existing.imagePreviews = parsedImg.images;
								existing.usageHint = parsedImg.usageHint;
							}
							return next;
						});
					} else if (kind === 'audio') {
						const transcript = extractAudioTranscriptionText(jsonText);
						setResults((prev) => {
							const next = new Map(prev);
							const existing = next.get(modelId);
							if (existing) {
								existing.status = 'done';
								existing.responseText = jsonText;
								existing.bodyText = transcript ?? jsonText;
							}
							return next;
						});
					} else {
						const parts = mergeAssistantTextParts(jsonText, protocol, 'json');
						const usageHint = tryParseUsageSummary(jsonText, protocol);
						setResults((prev) => {
							const next = new Map(prev);
							const existing = next.get(modelId);
							if (existing) {
								existing.status = 'done';
								existing.responseText = jsonText;
								existing.reasoningText = parts.reasoning;
								existing.bodyText = parts.body;
								existing.usageHint = usageHint;
							}
							return next;
						});
					}
					return;
				}

				// Determine parse mode from content type
				const parseMode: PlaygroundResponseParseMode = ct.includes('text/event-stream')
					? 'sse'
					: ct.includes('application/json')
						? 'json'
						: 'text';

				// Handle SSE stream
				if (ct.includes('text/event-stream') && res.body) {
					const reader = res.body.getReader();
					const dec = new TextDecoder();
					let acc = '';
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						acc += dec.decode(value, { stream: true });

						// Parse merged parts for display
						const parts = mergeAssistantTextParts(acc, protocol, parseMode);
						flushSync(() => {
							setResults((prev) => {
								const next = new Map(prev);
								const existing = next.get(modelId);
								if (existing) {
									existing.responseText = acc;
									existing.reasoningText = parts.reasoning;
									existing.bodyText = parts.body;
									existing.status = 'streaming';
								}
								return next;
							});
						});
					}
					acc += dec.decode();
					const finalParts = mergeAssistantTextParts(acc, protocol, parseMode);
					const usageHint = parseLastStreamUsage(acc, protocol);
					flushSync(() => {
						setResults((prev) => {
							const next = new Map(prev);
							const existing = next.get(modelId);
							if (existing) {
								existing.responseText = acc;
								existing.reasoningText = finalParts.reasoning;
								existing.bodyText = finalParts.body;
								existing.status = 'done';
								existing.usageHint = usageHint;
							}
							return next;
						});
					});
					return;
				}

				// Handle plain text response
				const text = await res.text();
				const parts = mergeAssistantTextParts(text, protocol, parseMode);
				const usageHint = parseLastStreamUsage(text, protocol);
				setResults((prev) => {
					const next = new Map(prev);
					const existing = next.get(modelId);
					if (existing) {
						existing.responseText = text;
						existing.reasoningText = parts.reasoning;
						existing.bodyText = parts.body;
						existing.status = 'done';
						existing.usageHint = usageHint;
					}
					return next;
				});
			} catch (e) {
				if (signal.aborted) {
					setResults((prev) => {
						const next = new Map(prev);
						const existing = next.get(modelId);
						if (existing) {
							existing.status = 'done';
							existing.errorMessage = null;
						}
						return next;
					});
					return;
				}
				setResults((prev) => {
					const next = new Map(prev);
					const existing = next.get(modelId);
					if (existing) {
						existing.status = 'error';
						existing.errorMessage = e instanceof Error ? e.message : String(e);
					}
					return next;
				});
			}
		},
		[prompt, audioFile, editFiles, imageOperation]
	);

	/* 可发送的选中模型：仅包含有 active 路由的模型（禁用模型不参与测试） */
	const sendableModelIds = useMemo(() => {
		const activeRouteModelIds = new Set<string>();
		for (const r of routes) {
			if (r.status === 'active') activeRouteModelIds.add(r.model_id);
		}
		return [...selectedModelIds].filter((id) => activeRouteModelIds.has(id));
	}, [selectedModelIds, routes]);

	/* 发送前校验：按选中模型的类型检查必要输入 */
	const sendBlockReason = useMemo((): string | null => {
		if (sendableModelIds.length === 0) return 'noModels';
		const selectedKinds = new Set<ModelKind>();
		for (const id of sendableModelIds) {
			const m = modelOptions.find((o) => o.id === id);
			if (m) selectedKinds.add(m.kind);
		}
		const needsPrompt = selectedKinds.has('llm') || selectedKinds.has('image');
		if (needsPrompt && !prompt.trim()) return 'noPrompt';
		if (selectedKinds.has('image') && imageOperation === 'edits' && editFiles.length === 0) {
			return 'noEditImages';
		}
		if (selectedKinds.has('audio') && !audioFile) return 'noAudioFile';
		return null;
	}, [sendableModelIds, modelOptions, prompt, imageOperation, editFiles, audioFile]);

	const sendBlockedHint = useMemo(() => {
		switch (sendBlockReason) {
			case 'noModels':
				return t('readyNeedModel');
			case 'noPrompt':
				return t('readyNeedPrompt');
			case 'noEditImages':
				return t('readyNeedEditImages');
			case 'noAudioFile':
				return t('readyNeedAudioFile');
			default:
				return null;
		}
	}, [sendBlockReason, t]);

	/* Send to all selected models */
	const sendAll = useCallback(async () => {
		if (sendableModelIds.length === 0 || sendBlockReason) return;
		setIsRunning(true);
		setResults(new Map());
		setProgress({ completed: 0, total: sendableModelIds.length });

		const controllers = new Map<string, AbortController>();
		abortControllersRef.current = controllers;

		const promises: Promise<void>[] = [];
		for (const modelId of sendableModelIds) {
			const route = pickBestRoute(modelId, routes);
			if (!route) continue;
			const model = models.find((m) => m.id === modelId);
			const modelName = model?.display_name || modelId;
			const kind = model ? modelKindOf(model) : 'llm';
			const controller = new AbortController();
			controllers.set(modelId, controller);
			promises.push(
				sendToModel(modelId, modelName, route, kind, controller.signal).then(() => {
					setProgress((prev) =>
						prev ? { ...prev, completed: prev.completed + 1 } : prev
					);
				})
			);
		}

		await Promise.allSettled(promises);
		setIsRunning(false);
		setProgress(null);
	}, [sendableModelIds, sendBlockReason, prompt, routes, models, sendToModel]);

	/* Stop all */
	const stopAll = useCallback(() => {
		for (const controller of abortControllersRef.current.values()) {
			controller.abort();
		}
		abortControllersRef.current.clear();
		setIsRunning(false);
	}, []);

	/* Copy all results */
	const copyAllResults = useCallback(() => {
		const lines: string[] = [];
		for (const [modelId, result] of results) {
			lines.push(`## ${result.modelName} (${result.providerName})`);
			lines.push('');
			if (result.reasoningText) {
				lines.push(`[Thinking]: ${result.reasoningText}`);
				lines.push('');
			}
			if (result.imagePreviews.length > 0) {
				lines.push(`[Images]: ${result.imagePreviews.length} generated`);
				lines.push('');
			}
			lines.push(result.bodyText || result.responseText || result.errorMessage || '(no response)');
			lines.push('');
			lines.push('---');
			lines.push('');
		}
		navigator.clipboard.writeText(lines.join('\n'));
	}, [results]);

	/* Results as sorted array（展示所有已有结果的模型，卡片上的勾选框独立控制选中状态） */
	const resultsList = useMemo(() => {
		const list: TestResult[] = [];
		for (const r of results.values()) {
			list.push(r);
		}
		return list;
	}, [results]);

	const hasResults = resultsList.length > 0;
	const allDone = hasResults && resultsList.every((r) => r.status === 'done' || r.status === 'error');

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full min-h-[240px]">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="shrink-0 border-b border-gray-200 bg-white px-6 py-4">
				<div className="flex items-start justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
						<p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						{statusError && (
							<span className="max-w-56 truncate rounded bg-red-50 px-2 py-1 text-[11px] text-red-600" title={statusError}>
								{statusError}
							</span>
						)}
						<button
							type="button"
							onClick={disableSelected}
							disabled={selectedModelIds.size === 0 || statusBusy}
							className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed"
						>
							{t('disableSelected')}
						</button>
						<button
							type="button"
							onClick={enableSelected}
							disabled={statusBusy || !hasDisabledSelected}
							className="rounded-md border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-600 hover:bg-green-100 disabled:opacity-40 disabled:cursor-not-allowed"
						>
							{t('enableSelected')}
						</button>
					</div>
				</div>
				<ProgressBar
					active={statusBusy}
					color="amber"
					label={statusBusy ? t('statusUpdating') : undefined}
					className="mt-3"
				/>
			</div>

			{loadError ? (
				<div className="m-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
					{loadError}
				</div>
			) : (
				<div className="flex flex-1 min-h-0 overflow-hidden">
					{/* Left panel: Model selection */}
					<div className="flex w-72 shrink-0 flex-col border-r border-gray-200 bg-gray-50/50">
						<div className="shrink-0 border-b border-gray-200 px-4 py-3">
							<div className="flex items-center justify-between mb-2">
								<span className="text-sm font-semibold text-gray-700">
									{t('selectModels')} ({selectedModelIds.size})
								</span>
								<div className="flex gap-1">
									<button
										type="button"
										onClick={selectAll}
										className="rounded px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50"
									>
										{tCommon('selectAll')}
									</button>
									<button
										type="button"
										onClick={clearSelection}
										className="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100"
									>
										{tCommon('clear')}
									</button>
								</div>
							</div>
							{/* Kind filter tabs */}
							<div className="mb-2 flex gap-1">
								{KIND_FILTERS.map((k) => (
									<button
										key={k.id}
										type="button"
										onClick={() => setKindFilter(k.id)}
										className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
											kindFilter === k.id
												? 'bg-slate-800 text-white'
												: 'bg-gray-100 text-gray-700 hover:bg-gray-200'
										}`}
									>
										{t(k.labelKey)}
										{k.id !== 'all' ? ` (${kindCounts[k.id]})` : ''}
									</button>
								))}
							</div>
							<input
								type="text"
								value={filterText}
								onChange={(e) => setFilterText(e.target.value)}
								placeholder={t('filterModels')}
								className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
							/>
						</div>
						<div className="flex-1 overflow-y-auto px-3 py-2">
							{filteredModelOptions.length === 0 ? (
								<p className="py-4 text-center text-xs text-gray-400">{t('noModelsAvailable')}</p>
							) : (
								<div className="space-y-1.5">
									{filteredModelOptions.map((model) => (
										<ModelChip
											key={model.id}
											model={model}
											selected={selectedModelIds.has(model.id)}
											onToggle={() => toggleModel(model.id)}
											t={t}
										/>
									))}
								</div>
							)}
						</div>
					</div>

					{/* Right panel: Prompt + Results */}
					<div className="flex flex-1 flex-col min-w-0 overflow-hidden">
						{/* Prompt area */}
						<div className="shrink-0 border-b border-gray-200 bg-white px-6 py-4">
							<div className="flex gap-3">
								<div className="flex-1">
									<textarea
										value={prompt}
										onChange={(e) => setPrompt(e.target.value)}
										placeholder={t('promptPlaceholder')}
										rows={3}
										className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
										disabled={isRunning}
									/>
									{/* Image operation + reference images */}
									{modelOptions.some((m) => m.kind === 'image') && (
										<div className="mt-2 flex flex-wrap items-center gap-3">
											<fieldset className="flex items-center gap-3 rounded-md border border-gray-200 px-3 py-1.5 text-sm">
												<span className="text-xs font-medium text-gray-600">{t('imageOperation')}</span>
												<label className="inline-flex items-center gap-1.5 cursor-pointer">
													<input
														type="radio"
														name="testConsoleImageOperation"
														className="text-blue-600 focus:ring-blue-500"
														checked={imageOperation === 'generations'}
														onChange={() => setImageOperation('generations')}
														disabled={isRunning}
													/>
													<span className="text-xs">generations</span>
												</label>
												<label className="inline-flex items-center gap-1.5 cursor-pointer">
													<input
														type="radio"
														name="testConsoleImageOperation"
														className="text-blue-600 focus:ring-blue-500"
														checked={imageOperation === 'edits'}
														onChange={() => setImageOperation('edits')}
														disabled={isRunning}
													/>
													<span className="text-xs">edits</span>
												</label>
											</fieldset>
											{imageOperation === 'edits' && (
												<div className="flex items-center gap-2">
													<input
														type="file"
														accept="image/png,image/jpeg,image/webp,image/*"
														multiple
														disabled={isRunning}
														className="text-xs file:mr-2 file:rounded file:border-0 file:bg-purple-50 file:px-2 file:py-1 file:text-xs file:font-medium file:text-purple-700"
														onChange={(e) => {
															const list = e.target.files ? Array.from(e.target.files) : [];
															setEditFiles(list.slice(0, IMAGE_MAX_REFERENCE_COUNT));
														}}
													/>
													<span className="text-[11px] text-gray-400">
														{editFiles.length > 0
															? `${editFiles.length} ${t('referenceImagesSelected')}`
															: t('referenceImagesHint', { max: IMAGE_MAX_REFERENCE_COUNT })}
													</span>
												</div>
											)}
										</div>
									)}
									{/* Audio file upload */}
									{modelOptions.some((m) => m.kind === 'audio') && (
										<div className="mt-2 flex items-center gap-2">
											<input
												type="file"
												accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac"
												disabled={isRunning}
												className="text-xs file:mr-2 file:rounded file:border-0 file:bg-teal-50 file:px-2 file:py-1 file:text-xs file:font-medium file:text-teal-700"
												onChange={(e) => {
													setAudioFile(e.target.files?.[0] ?? null);
												}}
											/>
											<span className="text-[11px] text-gray-400">
												{audioFile ? `${audioFile.name} (${audioFile.size} bytes)` : t('audioFileHint')}
											</span>
										</div>
									)}
								</div>
								<div className="flex flex-col gap-2">
									{isRunning ? (
										<button
											type="button"
											onClick={stopAll}
											className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
										>
											<StopIcon className="h-4 w-4" />
											{t('stop')}
										</button>
									) : (
										<button
											type="button"
											onClick={() => void sendAll()}
											disabled={sendableModelIds.length === 0 || sendBlockReason !== null}
											title={sendBlockedHint ?? undefined}
											className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
										>
											<PaperAirplaneIcon className="h-4 w-4" />
											{t('sendToAll', { count: sendableModelIds.length })}
										</button>
									)}
									{allDone && hasResults && (
										<button
											type="button"
											onClick={copyAllResults}
											className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
										>
											<ClipboardDocumentIcon className="h-4 w-4" />
											{t('copyAll')}
										</button>
									)}
								</div>
							</div>
							{sendBlockedHint && sendableModelIds.length > 0 && (
								<p className="mt-1 text-xs text-amber-700">{sendBlockedHint}</p>
							)}
						</div>

						{/* Results area */}
						<div className="flex-1 overflow-y-auto px-6 py-4">
							{!hasResults ? (
								<div className="flex h-full items-center justify-center">
									<div className="text-center text-gray-400">
										<PaperAirplaneIcon className="mx-auto h-12 w-12 mb-3 opacity-30" />
										<p className="text-sm">{t('emptyHint')}</p>
									</div>
								</div>
							) : (
								<div className={`grid gap-4 ${
									resultsList.length === 1
										? 'grid-cols-1 max-w-3xl'
										: resultsList.length === 2
											? 'grid-cols-1 lg:grid-cols-2'
											: 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3'
								}`}>
									{resultsList.map((result) => (
										<ResultCard
											key={result.modelId}
											result={result}
											selected={selectedModelIds.has(result.modelId)}
											onToggleSelect={() => toggleModel(result.modelId)}
											t={t}
										/>
									))}
								</div>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

export default function TestConsolePage() {
	return (
		<Suspense
			fallback={
				<div className="flex items-center justify-center h-full min-h-[240px]">
					<div className="text-gray-600">Loading…</div>
				</div>
			}
		>
			<TestConsolePageInner />
		</Suspense>
	);
}
