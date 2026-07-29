'use client';

import {
	CheckIcon,
	ClipboardDocumentIcon,
	ExclamationTriangleIcon,
	PencilSquareIcon,
	PowerIcon,
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
	const apiKeyFeedbackId = `provider-api-key:${provider.id}`;
	const rowAccent = pendingKey
		? 'border-l-amber-400'
		: !isActive
			? 'border-l-slate-300'
			: noKey
				? 'border-l-red-400'
				: 'border-l-emerald-400';

	return (
		<article
			className={`grid min-w-0 grid-cols-1 gap-3 border-l-2 px-4 py-3 transition-colors hover:bg-slate-50/80 lg:grid-cols-[minmax(210px,0.9fr)_minmax(340px,1.7fr)_minmax(180px,0.72fr)_auto] lg:items-center lg:gap-5 ${rowAccent}`}
		>
			<div className="flex min-w-0 items-start gap-3">
				<VendorIcon vendor={provider.vendor_key} iconKey={provider.icon_key} size="compact" />
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 flex-wrap items-center gap-1.5">
						<h2 className="min-w-0 truncate text-sm font-semibold text-gray-900" title={provider.name}>
							{provider.name}
						</h2>
						<span
							className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
								isActive
									? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
									: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200'
							}`}
						>
							<span
								aria-hidden
								className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`}
							/>
							{isActive ? tCommon('active') : t('disabled')}
						</span>
						{pendingKey ? (
							<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
								<ExclamationTriangleIcon className="h-3 w-3" aria-hidden />
								{t('pending')}
							</span>
						) : null}
						{isActive && noKey && !pendingKey ? (
							<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 ring-1 ring-inset ring-red-200">
								<ExclamationTriangleIcon className="h-3 w-3" aria-hidden />
								{t('noKey')}
							</span>
						) : null}
					</div>
					<p className="mt-0.5 truncate font-mono text-[10px] text-gray-500" title={provider.id}>
						{provider.id}
					</p>
					{provider.description ? (
						<p className="mt-1 line-clamp-2 text-xs leading-4 text-gray-500" title={provider.description}>
							{provider.description}
						</p>
					) : null}
				</div>
			</div>

			<div className="min-w-0">
				<p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 lg:hidden">
					{t('supportedEndpoints')}
				</p>
				{protocols.length > 0 ? (
					<div className="grid min-w-0 gap-1.5">
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
								<div
									key={protocol.key}
									className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
									title={capabilitiesTitle}
								>
									<span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200">
										<ProviderProtocolIcon protocol={protocol.key} />
									</span>
									<div className="min-w-0 flex-1">
										<div className="flex min-w-0 items-center gap-2">
											<span className="shrink-0 text-[11px] font-semibold text-gray-800">
												{protocol.label}
											</span>
											<span className="min-w-0 truncate font-mono text-[10px] text-gray-500">
												{protocol.url}
											</span>
										</div>
										{protocol.badges.length > 0 ? (
											<div className="mt-1 flex min-w-0 flex-wrap gap-1">
												{protocol.badges.map((badge) => (
													<span
														key={badge}
														className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium leading-3 text-blue-700 ring-1 ring-inset ring-blue-100"
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
										) : null}
									</div>
									<button
										type="button"
										onClick={() => void onCopyEndpoint(protocol.url, feedbackId)}
										className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
										title={
											copiedId === feedbackId
												? tCommon('copied')
												: tUpstream('endpointCopyTitle', {
														label: protocol.label,
														url: protocol.url,
													})
										}
										aria-label={
											copiedId === feedbackId
												? tCommon('copied')
												: tUpstream('endpointCopyTitle', {
														label: protocol.label,
														url: protocol.url,
													})
										}
									>
										{copiedId === feedbackId ? (
											<CheckIcon className="h-4 w-4 text-emerald-600" aria-hidden />
										) : (
											<ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
										)}
									</button>
								</div>
							);
						})}
					</div>
				) : (
					<div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-2 text-xs text-gray-400">
						{t('noEndpoint')}
					</div>
				)}
			</div>

			<div className="min-w-0">
				<p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 lg:hidden">
					{t('apiKey')}
				</p>
				<div
					className={`flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 ${
						pendingKey
							? 'border-amber-200 bg-amber-50/60'
							: noKey
								? 'border-red-200 bg-red-50/50'
								: 'border-slate-200 bg-white'
					}`}
				>
					<div className="min-w-0 flex-1">
						<p className="truncate font-mono text-[11px] text-gray-700" title={maskedKey || t('noKey')}>
							{maskedKey || t('noKey')}
						</p>
						{pendingKey ? (
							<p className="mt-0.5 text-[10px] text-amber-700">{t('placeholder')}</p>
						) : null}
					</div>
					<button
						type="button"
						onClick={() => void onCopyApiKey(provider)}
						disabled={noKey}
						className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-slate-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-35"
						title={copiedId === apiKeyFeedbackId ? tCommon('copied') : t('copyApiKey')}
						aria-label={copiedId === apiKeyFeedbackId ? tCommon('copied') : t('copyApiKey')}
					>
						{copiedId === apiKeyFeedbackId ? (
							<CheckIcon className="h-4 w-4 text-emerald-600" aria-hidden />
						) : (
							<ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
						)}
					</button>
				</div>
			</div>

			<div className="flex items-center justify-end gap-1.5">
				<button
					type="button"
					disabled={statusTogglingId === provider.id}
					onClick={() => void onToggleStatus(provider)}
					className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ring-1 ring-inset transition focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:opacity-50 ${
						isActive
							? 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100'
							: 'bg-slate-100 text-slate-500 ring-slate-200 hover:bg-slate-200'
					}`}
					title={isActive ? t('providerEnabled') : t('providerDisabled')}
					aria-label={isActive ? t('providerEnabled') : t('providerDisabled')}
				>
					<PowerIcon className="h-4 w-4" aria-hidden />
				</button>
				<button
					type="button"
					onClick={() => onEdit(provider)}
					className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
					title={t('editProvider')}
					aria-label={t('editProvider')}
				>
					<PencilSquareIcon className="h-4 w-4" aria-hidden />
				</button>
			</div>
		</article>
	);
}
