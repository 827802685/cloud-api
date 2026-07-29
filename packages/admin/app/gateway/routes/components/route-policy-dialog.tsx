'use client';

import { ROUTE_STRATEGY_NAMES } from '@octafuse/core/db/model-route-policy';
import { useTranslations } from 'next-intl';
import {
	CAPABILITIES_BY_PROTOCOL,
	isPromptCacheSensitiveCapability,
} from '../route-utils';
import type { RoutePolicyDialogState, RoutePolicyFormState } from '../types';

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
	const capabilities = CAPABILITIES_BY_PROTOCOL[dialog.protocol] ?? [];

	const strategyLabel = (value: string) => {
		if (!value) return t('inherit');
		if (value === 'affinity') return t('affinity');
		if (value === 'weighted_random') return t('weighted_random');
		if (value === 'strict') return t('strict');
		if (value === 'round_robin') return t('round_robin');
		return value;
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
			<div
				className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5"
				role="dialog"
				aria-modal="true"
				aria-labelledby="route-policy-dialog-title"
			>
				<div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
					<div>
						<h2 id="route-policy-dialog-title" className="text-base font-semibold text-gray-900">
							{t('title')}
						</h2>
						<p className="mt-1 text-xs text-gray-500">
							{dialog.modelTitle} · {dialog.protocolLabel} ·{' '}
							<span className="font-mono">{dialog.group}</span>
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						aria-label={tCommon('close')}
					>
						<span className="block text-xl leading-none" aria-hidden>
							×
						</span>
					</button>
				</div>
				<div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-5">
					{error && (
						<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
							{error}
						</div>
					)}
					<div>
						<label className="mb-1 block text-sm font-medium text-gray-700">{t('protocolLevel')}</label>
						<select
							value={form.protocolStrategy}
							onChange={(e) => onFormChange({ ...form, protocolStrategy: e.target.value })}
							className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
						>
							{STRATEGY_OPTIONS.map((opt) => (
								<option key={opt || 'inherit'} value={opt}>
									{strategyLabel(opt)}
								</option>
							))}
						</select>
						<p className="mt-1 text-xs leading-relaxed text-gray-500">{t('protocolLevelHint')}</p>
					</div>
					<div>
						<div className="mb-2 text-sm font-medium text-gray-700">{t('capabilityLevel')}</div>
						<p className="mb-3 text-xs leading-relaxed text-gray-500">{t('capabilityHint')}</p>
						<div className="space-y-3">
							{capabilities.map((cap) => (
								<div key={cap}>
									<label className="mb-1 block text-xs font-medium text-gray-600 font-mono">
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
										{isPromptCacheSensitiveCapability(cap) ? t('hintCache') : t('hintNoCache')}
									</p>
								</div>
							))}
						</div>
					</div>
				</div>
				<div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50/60 px-5 py-3.5">
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
