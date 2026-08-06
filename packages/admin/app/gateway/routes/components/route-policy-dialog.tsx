'use client';

import { ROUTE_STRATEGY_NAMES } from '@octafuse/core/db/model-route-policy';
import { useTranslations } from 'next-intl';
import {
	CAPABILITIES_BY_PROTOCOL,
	isPromptCacheSensitiveCapability,
} from '../route-utils';
import type { RoutePolicyDialogState, RoutePolicyFormState } from '../types';
import { RouteStrategyPicker } from './route-strategy-picker';

type Props = {
	dialog: RoutePolicyDialogState;
	form: RoutePolicyFormState;
	error: string;
	saving: boolean;
	onClose: () => void;
	onFormChange: (form: RoutePolicyFormState) => void;
	onSave: () => void;
};

const STRATEGY_OPTIONS = ['', ...ROUTE_STRATEGY_NAMES] as const;

export function RoutePolicyDialog(props: Props) {
	const { dialog, form, error, saving, onClose, onFormChange, onSave } = props;
	const t = useTranslations('routes.strategy');
	const tCommon = useTranslations('common');
	const capabilities = dialog.poolId ? [] : CAPABILITIES_BY_PROTOCOL[dialog.protocol] ?? [];
	const effectiveStrategy = form.protocolStrategy || dialog.inheritedStrategy;
	const activeTargets = dialog.targets.filter((target) => target.active);
	const activePriorities = [...new Set(activeTargets.map((target) => target.priority))].sort(
		(a, b) => b - a
	);

	const strategyLabel = (value: string) => {
		if (!value) return `${t('inherit')} → ${dialog.inheritedStrategy}`;
		if (value === 'affinity') return t('display.affinity');
		if (value === 'weighted_random') return t('display.weighted_random');
		if (value === 'strict') return t('display.strict');
		if (value === 'round_robin') return t('display.round_robin');
		return value;
	};

	const inheritedSourceLabel = t(`source.${dialog.inheritedSource}`);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !saving) onClose();
			}}
		>
			<div
				className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5"
				role="dialog"
				aria-modal="true"
				aria-labelledby="route-policy-dialog-title"
			>
				<div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4">
					<div>
						<h2 id="route-policy-dialog-title" className="text-base font-semibold text-gray-900">
							{t('title')}
						</h2>
						<p className="mt-1 text-xs text-gray-500">
							{dialog.modelTitle} · {dialog.protocolLabel} ·{' '}
							<span className="font-mono">{dialog.requestOperation ?? dialog.group}</span>
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						disabled={saving}
						className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
						aria-label={tCommon('close')}
					>
						<span className="block text-xl leading-none" aria-hidden>
							×
						</span>
					</button>
				</div>
				<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
					{error && (
						<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
							{error}
						</div>
					)}
					{capabilities.length > 0 ? (
						<div>
							<div className="mb-2 text-sm font-medium text-gray-700">
								{t('capabilityLevel')}
							</div>
							<p className="mb-3 text-xs leading-relaxed text-gray-500">
								{t('capabilityHint')}
							</p>
							<div className="space-y-3">
								{capabilities.map((cap) => (
									<div key={cap}>
										<label className="mb-1 block font-mono text-xs font-medium text-gray-600">
											{cap}
										</label>
										<select
											value={form.capabilityStrategies[cap] ?? ''}
											onChange={(e) =>
												onFormChange({
													...form,
													capabilityStrategies: {
														...form.capabilityStrategies,
														[cap]: e.target.value,
													},
												})
											}
											className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
										>
											{STRATEGY_OPTIONS.map((opt) => (
												<option key={opt || 'inherit'} value={opt}>
													{strategyLabel(opt)}
												</option>
											))}
										</select>
										<p className="mt-1 text-[11px] leading-relaxed text-gray-500">
											{isPromptCacheSensitiveCapability(cap)
												? t('hintCache')
												: t('hintNoCache')}
										</p>
									</div>
								))}
							</div>
						</div>
					) : null}

					<div>
						<div className="mb-1">
							<h3 className="text-sm font-semibold text-gray-900">{t('guideTitle')}</h3>
							<p className="mt-0.5 text-xs text-gray-500">{t('guideHint')}</p>
						</div>
						<RouteStrategyPicker
							value={form.protocolStrategy}
							onChange={(next) => onFormChange({ ...form, protocolStrategy: next })}
							allowInherit
							inheritedStrategy={dialog.inheritedStrategy}
							inheritedSourceLabel={inheritedSourceLabel}
							disabled={saving}
							className="mt-3"
						/>
					</div>

					<div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3.5">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div>
								<h3 className="text-sm font-semibold text-gray-900">{t('effectTitle')}</h3>
								<p className="mt-0.5 text-xs text-gray-500">{t('effectHint')}</p>
							</div>
							<span className="rounded-md bg-white px-2 py-1 font-mono text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
								{effectiveStrategy}
							</span>
						</div>
						<p className="mt-3 text-xs leading-relaxed text-gray-700">
							{t(`effect.${effectiveStrategy}`)}
						</p>
						<p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
							{t('priorityFirst')}
						</p>
						<p className="mt-1 text-[11px] leading-relaxed text-gray-500">
							{t('runtimeHealthHint')}
						</p>
						{effectiveStrategy === 'round_robin' ? (
							<p className="mt-1 text-[11px] leading-relaxed text-amber-700">
								{t('roundRobinInstanceHint')}
							</p>
						) : null}
						{activeTargets.length <= 1 ? (
							<p className="mt-2 rounded-md bg-white/80 px-2.5 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-200">
								{t('singleTargetEffect', { count: activeTargets.length })}
							</p>
						) : null}
						{activePriorities.length > 0 ? (
							<div className="mt-3 space-y-2">
								{activePriorities.map((priority, index) => {
									const layer = activeTargets
										.filter((target) => target.priority === priority)
										.sort((a, b) =>
											effectiveStrategy === 'strict'
												? b.weight - a.weight || a.providerId.localeCompare(b.providerId)
												: a.providerName.localeCompare(b.providerName)
										);
									const totalWeight = layer.reduce(
										(sum, target) => sum + Math.max(1, target.weight),
										0
									);
									return (
										<div key={priority} className="rounded-md border border-emerald-100 bg-white/85 p-2.5">
											<div className="mb-2 flex items-center gap-2">
												<span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-bold text-white">
													P{priority}
												</span>
												<span className="text-[10px] font-medium text-gray-500">
													{index === 0 ? t('firstAttemptLayer') : t('fallbackLayer')}
												</span>
											</div>
											<div className="space-y-1.5">
												{layer.map((target, targetIndex) => (
													<div
														key={target.id}
														className="flex min-w-0 items-center gap-2 text-xs"
													>
														<span className="w-4 shrink-0 text-right font-mono text-[10px] text-gray-400">
															{effectiveStrategy === 'strict' ? targetIndex + 1 : '•'}
														</span>
														<span className="min-w-0 flex-1 truncate font-medium text-gray-700">
															{target.providerName}
														</span>
														<span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-violet-700">
															W{target.weight}
														</span>
														{effectiveStrategy === 'weighted_random' ? (
															<span className="w-12 shrink-0 text-right font-mono text-[10px] text-emerald-700">
																{Math.round((Math.max(1, target.weight) / totalWeight) * 100)}%
															</span>
														) : null}
													</div>
												))}
											</div>
										</div>
									);
								})}
							</div>
						) : null}
						{dialog.targets.some((target) => !target.active) ? (
							<p className="mt-2 text-[11px] text-gray-500">{t('inactiveExcluded')}</p>
						) : null}
					</div>
				</div>
				<div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 bg-gray-50/60 px-6 py-3.5">
					<button
						type="button"
						onClick={onClose}
						disabled={saving}
						className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{tCommon('cancel')}
					</button>
					<button
						type="button"
						onClick={onSave}
						disabled={saving}
						className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{saving ? tCommon('savingDots') : tCommon('save')}
					</button>
				</div>
			</div>
		</div>
	);
}
