'use client';

/**
 * Test Console：以模型为中心的快速测试页面，支持多模型同时测试与对比。
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
import {
	mergeAssistantTextParts,
	type PlaygroundProtocol,
	type PlaygroundResponseParseMode,
} from '@/lib/playground/merge-assistant-text';
import { parseLastStreamUsage } from '@/lib/playground/usage-parsing';
import type { AdminModelRow } from '@/lib/services/admin/types';
import type { GatewayProvider } from '@/lib/types';
import { isImageGenerationModel, isAudioTranscriptionModel } from '@cloud-api/core/db/model-modalities';
import { ModelVendorIcon } from '@/components/model-vendor-icon';

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

type ModelOption = {
	id: string;
	display_name: string | null;
	vendor: string;
	is_llm: boolean;
};

type TestResult = {
	modelId: string;
	modelName: string;
	providerName: string;
	routeId: string;
	protocol: PlaygroundProtocol;
	status: 'pending' | 'streaming' | 'done' | 'error';
	responseText: string;
	reasoningText: string;
	bodyText: string;
	httpStatus: number | null;
	latencyMs: number | null;
	usageHint: string | null;
	errorMessage: string | null;
};

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_PROMPT = 'hi';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function pickBestRoute(
	modelId: string,
	routes: RouteRow[]
): RouteRow | null {
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

/* ------------------------------------------------------------------ */
/*  Components                                                         */
/* ------------------------------------------------------------------ */

function ModelChip(props: {
	model: ModelOption;
	selected: boolean;
	onToggle: () => void;
}) {
	const { model, selected, onToggle } = props;
	const displayName = model.display_name || model.id;
	return (
		<button
			type="button"
			onClick={onToggle}
			className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
				selected
					? 'border-blue-500 bg-blue-50 text-blue-900 ring-1 ring-blue-500'
					: 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
			}`}
		>
			<ModelVendorIcon vendor={model.vendor} size="compact" />
			<div className="min-w-0 flex-1">
				<div className="truncate font-medium">{displayName}</div>
				<div className="truncate font-mono text-[11px] text-gray-500">{model.id}</div>
			</div>
			{selected && (
				<svg className="h-4 w-4 shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
					<path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
				</svg>
			)}
		</button>
	);
}

function ResultCard(props: {
	result: TestResult;
	t: (key: string) => string;
}) {
	const { result, t } = props;
	const isPending = result.status === 'pending' || result.status === 'streaming';

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
				<div className="min-w-0">
					<div className="truncate text-sm font-semibold text-gray-900">{result.modelName}</div>
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
	const [filterText, setFilterText] = useState('');

	const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

	/* Build model options (only LLM models with active routes) */
	const modelOptions = useMemo<ModelOption[]>(() => {
		const modelsWithRoutes = new Set<string>();
		for (const r of routes) {
			if (r.status === 'active') {
				modelsWithRoutes.add(r.model_id);
			}
		}
		return models
			.filter((m) => modelsWithRoutes.has(m.id))
			.filter((m) => !isImageGenerationModel(m) && !isAudioTranscriptionModel(m))
			.map((m) => ({
				id: m.id,
				display_name: m.display_name,
				vendor: m.vendor,
				is_llm: true,
			}))
			.sort((a, b) => (a.display_name || a.id).localeCompare(b.display_name || b.id));
	}, [models, routes]);

	const filteredModelOptions = useMemo(() => {
		if (!filterText.trim()) return modelOptions;
		const q = filterText.trim().toLowerCase();
		return modelOptions.filter(
			(m) =>
				m.id.toLowerCase().includes(q) ||
				(m.display_name ?? '').toLowerCase().includes(q) ||
				m.vendor.toLowerCase().includes(q)
		);
	}, [modelOptions, filterText]);

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
		setSelectedModelIds(new Set(filteredModelOptions.map((m) => m.id)));
	}, [filteredModelOptions]);

	const clearSelection = useCallback(() => {
		setSelectedModelIds(new Set());
	}, []);

	/* Send test to a single model */
	const sendToModel = useCallback(
		async (modelId: string, modelName: string, route: RouteRow, signal: AbortSignal) => {
			const protocol = (route.upstream_protocol || 'openai') as PlaygroundProtocol;
			const body = buildChatBody(prompt, protocol);
			const providerName = route.provider_name || route.provider_id;

			// Initialize result
			const initResult: TestResult = {
				modelId,
				modelName,
				providerName,
				routeId: route.id,
				protocol,
				status: 'pending',
				responseText: '',
				reasoningText: '',
				bodyText: '',
				httpStatus: null,
				latencyMs: null,
				usageHint: null,
				errorMessage: null,
			};

			setResults((prev) => {
				const next = new Map(prev);
				next.set(modelId, { ...initResult });
				return next;
			});

			try {
				const res = await fetch('/api/admin/playground', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ routeId: route.id, body }),
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

				// Handle JSON error response
				if (ct.includes('application/json') && !ct.includes('text/event-stream')) {
					const j = (await res.json()) as Record<string, unknown>;
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
							existing.responseText = JSON.stringify(j, null, 2);
							existing.errorMessage = errMsg || 'Request failed';
						}
						return next;
					});
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
		[prompt]
	);

	/* Send to all selected models */
	const sendAll = useCallback(async () => {
		if (selectedModelIds.size === 0 || !prompt.trim()) return;
		setIsRunning(true);
		setResults(new Map());

		const controllers = new Map<string, AbortController>();
		abortControllersRef.current = controllers;

		const promises: Promise<void>[] = [];
		for (const modelId of selectedModelIds) {
			const route = pickBestRoute(modelId, routes);
			if (!route) continue;
			const model = models.find((m) => m.id === modelId);
			const modelName = model?.display_name || modelId;
			const controller = new AbortController();
			controllers.set(modelId, controller);
			promises.push(sendToModel(modelId, modelName, route, controller.signal));
		}

		await Promise.allSettled(promises);
		setIsRunning(false);
	}, [selectedModelIds, prompt, routes, models, sendToModel]);

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
			lines.push(result.bodyText || result.responseText || result.errorMessage || '(no response)');
			lines.push('');
			lines.push('---');
			lines.push('');
		}
		navigator.clipboard.writeText(lines.join('\n'));
	}, [results]);

	/* Results as sorted array */
	const resultsList = useMemo(() => {
		const list: TestResult[] = [];
		for (const id of selectedModelIds) {
			const r = results.get(id);
			if (r) list.push(r);
		}
		return list;
	}, [selectedModelIds, results]);

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
				<h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
				<p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
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
											disabled={selectedModelIds.size === 0 || !prompt.trim()}
											className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
										>
											<PaperAirplaneIcon className="h-4 w-4" />
											{t('sendToAll', { count: selectedModelIds.size })}
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
										<ResultCard key={result.modelId} result={result} t={t} />
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
