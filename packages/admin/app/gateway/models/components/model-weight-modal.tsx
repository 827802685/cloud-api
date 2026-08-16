'use client';

/**
 * Auto 模型选择权重管理弹窗。
 * 展示所有模型按 auto_weight 降序排列（直观看到 auto 模式的使用顺序），
 * 支持逐行修改权重与批量操作（全部设为同一值、按权重排序）。
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ModelVendorIcon } from '@/components/model-vendor-icon';
import type { ModelListItem } from '../types';

type Props = {
	open: boolean;
	models: ModelListItem[];
	onClose: () => void;
	onSave: (weights: Array<{ id: string; auto_weight: number }>) => Promise<void>;
};

type Row = {
	id: string;
	displayName: string;
	vendor: string;
	weight: number;
};

/** 排序：auto_weight 降序 → context_window 降序 → id 升序（与 auto 选择器一致）。 */
function sortRows(rows: Row[], models: ModelListItem[]): Row[] {
	const byId = new Map(models.map((m) => [m.id, m]));
	return [...rows].sort((a, b) => {
		if (a.weight !== b.weight) return b.weight - a.weight;
		const aCtx = byId.get(a.id)?.context_window ?? 0;
		const bCtx = byId.get(b.id)?.context_window ?? 0;
		if (aCtx !== bCtx) return bCtx - aCtx;
		return a.id.localeCompare(b.id);
	});
}

export function ModelWeightModal(props: Props) {
	const { open, models, onClose, onSave } = props;
	const t = useTranslations('models.weight');
	const tCommon = useTranslations('common');

	const [rows, setRows] = useState<Row[]>([]);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const [batchValue, setBatchValue] = useState('');

	useEffect(() => {
		if (!open) return;
		setRows(
			models.map((m) => ({
				id: m.id,
				displayName: m.display_name || m.id,
				vendor: m.vendor,
				weight: m.auto_weight ?? 0,
			}))
		);
		setBatchValue('');
		setError('');
	}, [open, models]);

	const sortedRows = useMemo(() => sortRows(rows, models), [rows, models]);

	if (!open) return null;

	const updateWeight = (id: string, raw: string) => {
		const value = raw.trim() === '' ? 0 : Number(raw);
		const weight = Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
		setRows((prev) => prev.map((r) => (r.id === id ? { ...r, weight } : r)));
	};

	const applyBatchValue = () => {
		const value = batchValue.trim() === '' ? 0 : Number(batchValue);
		const weight = Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
		setRows((prev) => prev.map((r) => ({ ...r, weight })));
	};

	const handleSave = async () => {
		setSaving(true);
		setError('');
		try {
			await onSave(rows.map((r) => ({ id: r.id, auto_weight: r.weight })));
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Save failed');
		} finally {
			setSaving(false);
		}
	};

	const dirty = rows.some((r) => r.weight !== (models.find((m) => m.id === r.id)?.auto_weight ?? 0));

	return (
		<div
			className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4"
			onClick={onClose}
		>
			<div
				className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
				role="dialog"
				aria-modal="true"
				aria-labelledby="model-weight-title"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex shrink-0 items-start justify-between gap-4 border-b px-6 py-4">
					<div className="min-w-0">
						<h2 id="model-weight-title" className="text-lg font-bold text-gray-900">
							{t('title')}
						</h2>
						<p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="shrink-0 text-gray-400 hover:text-gray-600"
						aria-label={tCommon('close')}
					>
						×
					</button>
				</div>

				<div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-gray-50 px-6 py-3">
					<span className="text-sm font-medium text-gray-700">{t('batchLabel')}</span>
					<input
						type="number"
						min={0}
						step={1}
						value={batchValue}
						onChange={(e) => setBatchValue(e.target.value)}
						placeholder={t('batchPlaceholder')}
						className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
					/>
					<button
						type="button"
						onClick={applyBatchValue}
						className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-100"
					>
						{t('batchApply')}
					</button>
					<span className="ml-auto text-xs text-gray-400">{t('orderHint')}</span>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
					{sortedRows.length === 0 ? (
						<p className="py-10 text-center text-sm text-gray-400">{t('empty')}</p>
					) : (
						<table className="w-full border-collapse text-sm">
							<thead>
								<tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-500">
									<th className="py-2 pr-2 font-medium">{t('colOrder')}</th>
									<th className="py-2 pr-2 font-medium">{t('colModel')}</th>
									<th className="py-2 pr-2 font-medium">{t('colVendor')}</th>
									<th className="py-2 pr-2 font-medium">{t('colWeight')}</th>
								</tr>
							</thead>
							<tbody>
								{sortedRows.map((row, index) => (
									<tr key={row.id} className="border-b border-gray-100 last:border-0">
										<td className="py-2 pr-2">
											<span
												className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${
													index === 0
														? 'bg-blue-600 text-white'
														: 'bg-gray-100 text-gray-600'
												}`}
												title={t('orderTitle', { rank: index + 1 })}
											>
												{index + 1}
											</span>
										</td>
										<td className="max-w-[260px] py-2 pr-2">
											<div className="flex min-w-0 items-center gap-2">
												<ModelVendorIcon vendor={row.vendor} size="compact" />
												<div className="min-w-0">
													<p className="truncate font-medium text-gray-900" title={row.displayName}>
														{row.displayName}
													</p>
													<p className="truncate font-mono text-xs text-gray-500" title={row.id}>
														{row.id}
													</p>
												</div>
											</div>
										</td>
										<td className="py-2 pr-2 text-gray-600">{row.vendor}</td>
										<td className="py-2 pr-2">
											<input
												type="number"
												min={0}
												step={1}
												value={row.weight}
												onChange={(e) => updateWeight(row.id, e.target.value)}
												className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right text-sm tabular-nums focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
											/>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>

				{error ? <p className="shrink-0 px-6 pb-2 text-sm text-red-600">{error}</p> : null}

				<div className="flex shrink-0 justify-end gap-2 border-t bg-gray-50 px-6 py-4">
					<button
						type="button"
						onClick={onClose}
						disabled={saving}
						className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-white disabled:opacity-50"
					>
						{tCommon('cancel')}
					</button>
					<button
						type="button"
						onClick={() => void handleSave()}
						disabled={saving || !dirty}
						className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
					>
						{saving ? tCommon('saving') : t('save')}
					</button>
				</div>
			</div>
		</div>
	);
}
