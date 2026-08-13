'use client';

import { ArrowDownTrayIcon, PlusIcon, TrashIcon, CheckIcon, XMarkIcon, BoltIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

type Props = {
	activeVendorTitle: string;
	selectedCount: number;
	hasModels: boolean;
	importSubmitting: boolean;
	onImport: () => void;
	onCreate: () => void;
	createTitle: string;
	batchMode: boolean;
	onToggleBatchMode: () => void;
	batchSelectedCount: number;
	onSelectAllVisible: () => void;
	onClearBatchSelection: () => void;
	onBatchDelete: () => void;
	isBatchDeleting: boolean;
	onAutoAddRoutes: () => void;
	isAutoAddingRoutes: boolean;
	onRssSync: () => void;
	isRssSyncing: boolean;
	rssLastSyncAt: string | null;
};

export function ModelCatalogToolbar(props: Props) {
	const {
		activeVendorTitle,
		selectedCount,
		hasModels,
		importSubmitting,
		onImport,
		onCreate,
		createTitle,
		batchMode,
		onToggleBatchMode,
		batchSelectedCount,
		onSelectAllVisible,
		onClearBatchSelection,
		onBatchDelete,
		isBatchDeleting,
		onAutoAddRoutes,
		isAutoAddingRoutes,
		onRssSync,
		isRssSyncing,
		rssLastSyncAt,
	} = props;

	const t = useTranslations('models.catalog');
	const tCommon = useTranslations('common');

	return (
		<div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200/80 bg-white/95 px-4 py-3 backdrop-blur-sm sm:px-6">
			<div className="min-w-0">
				<h2 className="text-base font-semibold text-gray-900">{t('title')}</h2>
				{hasModels ? (
					<p className="mt-0.5 truncate text-xs text-gray-500" title={activeVendorTitle}>
						{batchMode
							? `${batchSelectedCount} selected for deletion`
							: selectedCount === 1
								? t('vendorModels', { vendor: activeVendorTitle, count: selectedCount })
								: t('vendorModelsPlural', { vendor: activeVendorTitle, count: selectedCount })}
					</p>
				) : (
					<p className="mt-0.5 text-xs text-gray-500">{t('noModelsYet')}</p>
				)}
			</div>
			<div className="flex shrink-0 flex-wrap items-center gap-2">
				{batchMode ? (
					<>
						<button
							type="button"
							onClick={onSelectAllVisible}
							className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
						>
							<CheckIcon className="h-4 w-4" />
							{tCommon('selectAll')}
						</button>
						<button
							type="button"
							onClick={onClearBatchSelection}
							disabled={batchSelectedCount === 0}
							className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50"
						>
							<XMarkIcon className="h-4 w-4" />
							{tCommon('clear')}
						</button>
						<button
							type="button"
							onClick={onBatchDelete}
							disabled={batchSelectedCount === 0 || isBatchDeleting}
							className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
						>
							<TrashIcon className="h-4 w-4" />
							{isBatchDeleting ? tCommon('deleting') : `${tCommon('delete')} (${batchSelectedCount})`}
						</button>
						<button
							type="button"
							onClick={onToggleBatchMode}
							className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
						>
							{tCommon('cancel')}
						</button>
					</>
				) : (
					<>
						<button
							type="button"
							onClick={onToggleBatchMode}
							disabled={!hasModels}
							className="flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:opacity-50"
						>
							<TrashIcon className="h-4 w-4" />
							{tCommon('batchDelete')}
						</button>
						<button
							type="button"
							onClick={onAutoAddRoutes}
							disabled={!hasModels || isAutoAddingRoutes}
							className="flex items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50"
							title="Auto-add routes for all models"
						>
							<BoltIcon className="h-4 w-4" />
							{isAutoAddingRoutes ? 'Adding...' : 'Auto Routes'}
						</button>
						<button
							type="button"
							onClick={onRssSync}
							disabled={isRssSyncing}
							className="flex items-center gap-1.5 rounded-md border border-sky-300 bg-white px-3 py-2 text-sm text-sky-700 hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-50"
							title={
								rssLastSyncAt
									? `Last RSS sync: ${new Date(rssLastSyncAt).toLocaleString()}`
									: 'Sync free models from RSS'
							}
						>
							<ArrowPathIcon className={`h-4 w-4 ${isRssSyncing ? 'animate-spin' : ''}`} />
							{isRssSyncing ? 'Syncing...' : 'RSS Sync'}
						</button>
						<button
							type="button"
							onClick={onImport}
							disabled={importSubmitting}
							className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-gray-800 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50"
						>
							<ArrowDownTrayIcon className="h-5 w-5" />
							{tCommon('import')}
						</button>
						<button
							type="button"
							onClick={onCreate}
							className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
							title={createTitle}
						>
							<PlusIcon className="h-5 w-5" />
							{tCommon('new')}
						</button>
					</>
				)}
			</div>
		</div>
	);
}
