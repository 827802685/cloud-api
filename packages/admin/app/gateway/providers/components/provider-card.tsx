'use client';

import {
	CheckIcon,
	ClipboardDocumentIcon,
	ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { VendorIcon } from '@/components/model-vendor-icon';
import type { GatewayProvider } from '../types';
import { getProviderProtocolSummaries } from '../provider-utils';
import { ProviderProtocolIcon } from './provider-protocol-icon';

type ProviderCardProps = {
	provider: GatewayProvider;
	copiedId: string | null;
	statusTogglingId: string | null;
	onEdit: (provider: GatewayProvider) => void;
	onCopyEndpoint: (text: string, feedbackId: string) => void;
	onToggleStatus: (provider: GatewayProvider) => void;
	onCopyApiKey: (provider: GatewayProvider) => void;
};

export function ProviderCard(props: ProviderCardProps) {
	const {
		provider,
		copiedId,
		statusTogglingId,
		onEdit,
		onCopyEndpoint,
		onToggleStatus,
		onCopyApiKey,
	} = props;

	const t = useTranslations('providers.card');
	const tUpstream = useTranslations('upstream');
	const tCommon = useTranslations('common');

	const protocols = getProviderProtocolSummaries(provider);
	const pendingKey = Boolean(provider.has_pending_key);
	const isActive = provider.status !== 'disabled';
	const maskedKey = provider.api_key?.trim() || '';
	const noKey = !maskedKey || maskedKey === '(empty)' || pendingKey;

	return (
		<article
			role="button"
			tabIndex={0}
			onClick={() => onEdit(provider)}
			onKeyDown={(e) => {
				if (e.target !== e.currentTarget) return;
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onEdit(provider);
				}
			}}
			className={
				'relative cursor-pointer overflow-hidden rounded-xl border bg-white shadow-md shadow-slate-200/70 ring-1 ring-black/[0.03] transition-all duration-200 ease-out hover:-translate-y-1 hover:border-blue-300 hover:bg-blue-50/30 hover:shadow-xl hover:shadow-blue-100/80 hover:ring-1 hover:ring-blue-200 focus:outline-none focus-visible:border-blue-400 focus-visible:bg-blue-50/30 focus-visible:shadow-lg focus-visible:ring-2 focus-visible:ring-blue-500 active:translate-y-0 ' +
				(pendingKey
					? 'border-amber-300 ring-amber-100'
					: !isActive
						? 'border-slate-300 ring-slate-100'
						: noKey
							? 'border-red-300 ring-red-100'
							: 'border-slate-200')
			}
		>
			<div
				aria-hidden
				className={
					'h-1 w-full ' +
					(pendingKey
						? 'bg-amber-300'
						: !isActive
							? 'bg-slate-300'
							: noKey
								? 'bg-red-300'
								: 'bg-slate-200')
				}
			/>
			<div className="flex min-h-[5.75rem] flex-col p-3">
				<div className="min-h-[2.75rem] min-w-0">
					<div className="flex min-w-0 items-start gap-2">
						<VendorIcon vendor={provider.vendor_key} iconKey={provider.icon_key} size="compact" />
						<div className="min-w-0 flex-1">
							<h2 className="truncate text-base font-semibold leading-6 text-gray-900" title={provider.name}>
								{provider.name}
							</h2>
							<div className="mt-0.5 flex min-w-0 items-center gap-2">
								<span className="truncate font-mono text-[11px] leading-4 text-gray-500" title={provider.id}>
									{provider.id}
								</span>
							</div>
						</div>
						<div className="flex shrink-0 flex-wrap justify-end gap-1">
							{pendingKey && (
								<span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
									<ExclamationTriangleIcon className="h-3.5 w-3.5" aria-hidden />
									{t('pending')}
								</span>
							)}
							{!isActive && (
								<span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
									{t('disabled')}
								</span>
							)}
							{isActive && noKey && !pendingKey && (
								<span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-800">
									<ExclamationTriangleIcon className="h-3.5 w-3.5" aria-hidden />
									{t('noKey')}
								</span>
							)}
						</div>
					</div>
				</div>

				<div className="mt-2 flex min-h-[2rem] items-start">
					{protocols.length > 0 ? (
						<div className="flex w-full flex-wrap items-start gap-2">
							{protocols.map((protocol) => {
								const feedbackId = `endpoint:${provider.id}:${protocol.key}`;
								const badgeLabels = protocol.badges.map((badge) => t(`cap.${badge}`));
								const capabilitiesTitle =
									protocol.capabilities.length > 0
										? t('capabilitiesTitle', {
												label: protocol.label,
												caps: protocol.capabilities.join(', '),
												url: protocol.url,
											})
										: tUpstream('endpointCopyTitle', { label: protocol.label, url: protocol.url });
								return (
									<div key={protocol.key} className="inline-flex max-w-full items-center gap-1">
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												void onCopyEndpoint(protocol.url, feedbackId);
											}}
											className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
											title={capabilitiesTitle}
										>
											{copiedId === feedbackId ? (
												<CheckIcon className="h-4 w-4 shrink-0 text-green-600" aria-hidden />
											) : (
												<ProviderProtocolIcon protocol={protocol.key} />
											)}
											<span className="sr-only">{protocol.label}</span>
										</button>
										{protocol.badges.length > 0 && (
											<div className="flex min-w-0 flex-wrap gap-0.5" title={capabilitiesTitle}>
												{protocol.badges.map((badge) => (
													<span
														key={badge}
														className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium leading-3 text-slate-600"
													>
														{t(`cap.${badge}`)}
													</span>
												))}
												<span className="sr-only">
													{t('capabilitiesSr', {
														label: protocol.label,
														caps: badgeLabels.join(', '),
													})}
												</span>
											</div>
										)}
									</div>
								);
							})}
						</div>
					) : (
						<div className="rounded-md border border-dashed border-gray-200 px-2 py-1.5 text-xs text-gray-400">
							{t('noEndpoint')}
						</div>
					)}
				</div>
			</div>

			<div className="border-t border-gray-100 bg-gray-50/70 px-3 py-2" onClick={(e) => e.stopPropagation()}>
				<div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
					<input
						type="checkbox"
						checked={isActive}
						disabled={statusTogglingId === provider.id}
						onChange={() => void onToggleStatus(provider)}
						className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
						aria-label={isActive ? t('providerEnabled') : t('providerDisabled')}
					/>
					<div className="flex min-w-0 items-center gap-1.5">
						<span
							className="min-w-0 truncate font-mono text-[11px] leading-4 text-gray-600"
							title={maskedKey || t('noKey')}
						>
							{maskedKey || t('noKey')}
						</span>
						{pendingKey && (
							<span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
								{t('placeholder')}
							</span>
						)}
					</div>
					<button
						type="button"
						onClick={() => void onCopyApiKey(provider)}
						className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-white hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
						title={
							copiedId === `provider-api-key:${provider.id}`
								? tCommon('copied')
								: t('copyApiKey')
						}
						aria-label={
							copiedId === `provider-api-key:${provider.id}`
								? tCommon('copied')
								: t('copyApiKey')
						}
					>
						{copiedId === `provider-api-key:${provider.id}` ? (
							<CheckIcon className="h-4 w-4 text-green-600" aria-hidden />
						) : (
							<ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
						)}
					</button>
				</div>
			</div>
		</article>
	);
}
