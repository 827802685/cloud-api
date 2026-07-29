'use client';

import {
	ArrowDownIcon,
	ArrowLongRightIcon,
	CheckCircleIcon,
	ClipboardDocumentIcon,
	ExclamationTriangleIcon,
	PencilSquareIcon,
	PlusIcon,
	PowerIcon,
} from '@heroicons/react/24/outline';
import {
	isAudioTranscriptionModel,
	isImageGenerationModel,
} from '@octafuse/core/db/model-modalities';
import { parseModelRoutePolicy, routePolicyRuleKey } from '@octafuse/core/db/model-route-policy';
import { parseRoutePricingSchedule } from '@octafuse/core/db/pricing-schedule';
import { useTranslations } from 'next-intl';
import { UpstreamProtocolBrandIcon } from '@/components/upstream-brand-logo';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import {
	parseChargedFactorFromPriceOverride,
	parseMeteredFactorFromPriceOverride,
} from '@/lib/pricing-ui';
import type { GatewayModel, GatewayProvider } from '@/lib/types';
import { tagBadgeClass } from '../../models/model-utils';
import type { RouteModelGroup } from '../route-utils';
import {
	factorChipClassForValue,
	formatFactorMultiplier,
	formatFactorMultiplierForChip,
	formatScheduleWindowsHint,
	parseModelTagsList,
	protocolBadgeClass,
	splitRoutesByProtocolAndRouteGroup,
} from '../route-utils';
import {
	FACTOR_CHIP_BASE,
	ROUTE_GROUP_CARD_BADGE_CLASS,
	type RouteListRow,
	type RouteProtocolGroupSection,
} from '../types';

type Props = {
	card: RouteModelGroup;
	meta: GatewayModel | undefined;
	providerMeta: Map<string, GatewayProvider>;
	copiedModelId: string | null;
	togglingId: string | null;
	onCopyModelId: (modelId: string) => void;
	onCreate: (modelId: string, preset?: { protocol?: string; group?: string }) => void;
	onEdit: (route: RouteListRow) => void;
	onEditModel: (modelId: string) => void;
	onToggleStatus: (route: RouteListRow) => void;
	onOpenStrategyDialog: (
		modelId: string,
		modelTitle: string,
		protocol: string,
		protocolLabel: string,
		group: string
	) => void;
};

function RouteTarget({
	route,
	provider,
	togglingId,
	onEdit,
	onToggleStatus,
}: {
	route: RouteListRow;
	provider: GatewayProvider | undefined;
	togglingId: string | null;
	onEdit: (route: RouteListRow) => void;
	onToggleStatus: (route: RouteListRow) => void;
}) {
	const t = useTranslations('routes.flow');
	const tList = useTranslations('routes.listItem');
	const charged = parseChargedFactorFromPriceOverride(route.price_override);
	const metered = parseMeteredFactorFromPriceOverride(route.price_override);
	const chargedValue = charged != null && Number.isFinite(charged) ? charged : 1;
	const meteredValue = metered != null && Number.isFinite(metered) ? metered : 1;
	const schedule = parseRoutePricingSchedule(route.price_override);
	const scheduleHint =
		formatScheduleWindowsHint(schedule.charged) || formatScheduleWindowsHint(schedule.metered);
	const enabled = route.status === 'active';
	const providerDisabled = provider?.status === 'disabled';

	return (
		<div
			className={`min-w-0 rounded-lg border bg-white shadow-sm transition hover:border-blue-300 hover:shadow-md ${
				enabled ? 'border-gray-200' : 'border-gray-200 bg-gray-50/80 opacity-70'
			}`}
		>
			<div className="flex items-start gap-2.5 p-3">
				<button
					type="button"
					onClick={() => onToggleStatus(route)}
					disabled={togglingId === route.id}
					className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-wait disabled:opacity-50 ${
						enabled
							? 'bg-emerald-50 text-emerald-600 ring-emerald-200 hover:bg-emerald-100'
							: 'bg-gray-100 text-gray-400 ring-gray-200 hover:bg-gray-200'
					}`}
					title={enabled ? tList('routeEnabled') : tList('routeDisabled')}
					aria-label={enabled ? tList('routeEnabled') : tList('routeDisabled')}
				>
					{enabled ? <CheckCircleIcon className="h-4 w-4" /> : <PowerIcon className="h-4 w-4" />}
				</button>
				<button
					type="button"
					onClick={() => onEdit(route)}
					className="min-w-0 flex-1 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
					title={t('editRoute')}
				>
					<div className="flex min-w-0 items-center gap-2">
						<span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-900">
							{route.provider_name || provider?.name || route.provider_id}
						</span>
						<PencilSquareIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
					</div>
					<p className="mt-0.5 truncate font-mono text-[11px] text-gray-500" title={route.provider_model_name}>
						{route.provider_model_name}
					</p>
				</button>
			</div>
			<div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-3 py-2">
				<span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-200">
					{t('weight', { value: route.weight ?? 1 })}
				</span>
				<span
					className={factorChipClassForValue(chargedValue)}
					title={tList('chargedTooltip', { value: formatFactorMultiplier(chargedValue) })}
				>
					{t('chargedShort')} {formatFactorMultiplierForChip(chargedValue)}
				</span>
				<span
					className={factorChipClassForValue(meteredValue)}
					title={tList('meteredTooltip', { value: formatFactorMultiplier(meteredValue) })}
				>
					{t('meteredShort')} {formatFactorMultiplierForChip(meteredValue)}
				</span>
				{scheduleHint ? (
					<span className={`${FACTOR_CHIP_BASE} w-auto bg-sky-50 text-sky-800 ring-sky-200`} title={scheduleHint}>
						{t('scheduled')}
					</span>
				) : null}
				{route.custom_params ? (
					<span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 ring-1 ring-inset ring-gray-200">
						{t('defaults')}
					</span>
				) : null}
				{providerDisabled ? (
					<span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
						<ExclamationTriangleIcon className="h-3 w-3" />
						{t('providerDisabled')}
					</span>
				) : null}
			</div>
		</div>
	);
}

function FlowSection({
	section,
	card,
	meta,
	providerMeta,
	togglingId,
	onCreate,
	onEdit,
	onToggleStatus,
	onOpenStrategyDialog,
}: {
	section: RouteProtocolGroupSection<RouteListRow>;
	card: RouteModelGroup;
	meta: GatewayModel | undefined;
	providerMeta: Map<string, GatewayProvider>;
	togglingId: string | null;
	onCreate: Props['onCreate'];
	onEdit: Props['onEdit'];
	onToggleStatus: Props['onToggleStatus'];
	onOpenStrategyDialog: Props['onOpenStrategyDialog'];
}) {
	const t = useTranslations('routes.flow');
	const policy = parseModelRoutePolicy(meta?.route_policy ?? null);
	const strategy =
		policy?.rules.get(routePolicyRuleKey(section.protocol, null, section.group))?.strategy ??
		policy?.strategy ??
		null;
	const priorityLayers = [...section.routes.reduce((map, route) => {
		const layer = map.get(route.priority) ?? [];
		layer.push(route);
		map.set(route.priority, layer);
		return map;
	}, new Map<number, RouteListRow[]>())].sort(([a], [b]) => b - a);
	const requestKey = section.group === 'default' ? card.model_id : `${card.model_id}:${section.group}`;

	return (
		<div className="bg-slate-50/70 p-3 sm:p-4">
			<div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(180px,0.8fr)_32px_minmax(210px,0.9fr)_32px_minmax(360px,2fr)] xl:items-center">
				<div className="min-w-0 rounded-lg border border-blue-200 bg-blue-50/80 p-3 ring-1 ring-inset ring-white">
					<p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">{t('requestNode')}</p>
					<p className="mt-1 truncate font-mono text-xs font-semibold text-gray-900" title={requestKey}>
						{requestKey}
					</p>
					<p className="mt-1 text-[11px] text-gray-500">{t('modelGroupResolved')}</p>
				</div>

				<ArrowLongRightIcon className="mx-auto hidden h-5 w-5 text-blue-300 xl:block" />

				<button
					type="button"
					onClick={() =>
						onOpenStrategyDialog(
							card.model_id,
							card.title,
							section.protocol,
							section.protocolLabel,
							section.group
						)
					}
					className="min-w-0 rounded-lg border border-indigo-200 bg-indigo-50/70 p-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
				>
					<div className="flex min-w-0 flex-wrap items-center gap-1.5">
						<span className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${protocolBadgeClass(section.protocol)}`}>
							<UpstreamProtocolBrandIcon protocol={section.protocol} />
							{section.protocolLabel}
						</span>
						<span className={`max-w-full truncate rounded-md px-2 py-0.5 text-[11px] font-semibold ${ROUTE_GROUP_CARD_BADGE_CLASS}`}>
							{section.group}
						</span>
					</div>
					<div className="mt-2 flex items-center justify-between gap-2">
						<div>
							<p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600">{t('policyNode')}</p>
							<p className="mt-0.5 text-xs font-semibold text-gray-800">
								{strategy ? t('strategyValue', { strategy }) : t('strategyInherit')}
							</p>
						</div>
						<PencilSquareIcon className="h-4 w-4 shrink-0 text-indigo-400" />
					</div>
					<p className="mt-1.5 text-[11px] text-gray-500">{t('priorityHint')}</p>
				</button>

				<ArrowLongRightIcon className="mx-auto hidden h-5 w-5 text-blue-300 xl:block" />

				<div className="min-w-0">
					<div className="mb-2 flex items-center justify-between gap-2">
						<div>
							<p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">{t('targetsNode')}</p>
							<p className="text-[11px] text-gray-500">{t('targetCount', { count: section.routes.length })}</p>
						</div>
						<button
							type="button"
							onClick={() => onCreate(card.model_id, { protocol: section.protocol, group: section.group })}
							className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-blue-600 ring-1 ring-inset ring-blue-200 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						>
							<PlusIcon className="h-3.5 w-3.5" />
							{t('addToPool')}
						</button>
					</div>
					<div className="space-y-2">
						{priorityLayers.map(([priority, routes], layerIndex) => (
							<div key={priority}>
								{layerIndex > 0 ? (
									<div className="flex items-center gap-2 py-1 text-[10px] font-medium text-gray-400">
										<ArrowDownIcon className="h-3.5 w-3.5" />
										<span>{t('fallback')}</span>
									</div>
								) : null}
								<div className="rounded-lg border border-gray-200/80 bg-white/60 p-2">
									<div className="mb-1.5 flex items-center gap-2">
										<span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-bold text-white">
											P{priority}
										</span>
										<span className="text-[10px] font-medium text-gray-500">
											{layerIndex === 0 ? t('firstAttempt') : t('fallbackLayer')}
										</span>
									</div>
									<div className="grid min-w-0 gap-2 2xl:grid-cols-2">
										{routes.map((route) => (
											<RouteTarget
												key={route.id}
												route={route}
												provider={providerMeta.get(route.provider_id)}
												togglingId={togglingId}
												onEdit={onEdit}
												onToggleStatus={onToggleStatus}
											/>
										))}
									</div>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

export function RouteModelFlow(props: Props) {
	const {
		card,
		meta,
		providerMeta,
		copiedModelId,
		togglingId,
		onCopyModelId,
		onCreate,
		onEdit,
		onEditModel,
		onToggleStatus,
		onOpenStrategyDialog,
	} = props;
	const t = useTranslations('routes.card');
	const tFlow = useTranslations('routes.flow');
	const tModelsCard = useTranslations('models.card');
	const isImage = meta ? isImageGenerationModel(meta) : false;
	const isAudio = meta ? isAudioTranscriptionModel(meta) : false;
	const context = formatCompactTokens(meta?.context_window);
	const maxOutput = formatCompactTokens(meta?.max_tokens);
	const stats = isAudio
		? t('audioModelHint')
		: isImage
			? t('imageModelHint')
			: t('contextLine', { context, max: maxOutput });
	const tags = parseModelTagsList(meta);
	const sections = splitRoutesByProtocolAndRouteGroup(card.groupRoutes);

	return (
		<article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
			<header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 sm:px-5">
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<button
							type="button"
							onClick={() => onEditModel(card.model_id)}
							className="truncate text-left text-sm font-semibold text-gray-900 underline-offset-2 hover:text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						>
							{card.title}
						</button>
						<span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${card.activeCount > 0 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-red-50 text-red-700 ring-red-200'}`}>
							{t('activeTotalRoutes', { active: card.activeCount, total: card.groupRoutes.length })}
						</span>
					</div>
					<div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
						<span className="font-mono text-[11px] text-gray-500">{card.model_id}</span>
						<span className="text-gray-300">·</span>
						<span className="text-[11px] text-gray-500">{stats}</span>
						{tags.length ? tags.slice(0, 4).map((tag) => (
							<span key={tag} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tagBadgeClass(tag)}`}>
								{tag}
							</span>
						)) : <span className="text-[10px] text-gray-400">{tModelsCard('noTags')}</span>}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<button
						type="button"
						onClick={() => void onCopyModelId(card.model_id)}
						className={`rounded-md p-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${copiedModelId === card.model_id ? 'bg-emerald-50 text-emerald-600' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'}`}
						title={copiedModelId === card.model_id ? t('copiedModelId') : t('copyModelId', { id: card.model_id })}
					>
						<ClipboardDocumentIcon className="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={() => onEditModel(card.model_id)}
						className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						title={t('editModel', { title: card.title })}
					>
						<PencilSquareIcon className="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={() => onCreate(card.model_id)}
						className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
					>
						<PlusIcon className="h-4 w-4" />
						{tFlow('addRoute')}
					</button>
				</div>
			</header>

			<div className="space-y-3 bg-slate-100/60 p-3 sm:p-4">
				{sections.length ? sections.map((section) => (
					<FlowSection
						key={section.key}
						section={section}
						card={card}
						meta={meta}
						providerMeta={providerMeta}
						togglingId={togglingId}
						onCreate={onCreate}
						onEdit={onEdit}
						onToggleStatus={onToggleStatus}
						onOpenStrategyDialog={onOpenStrategyDialog}
					/>
				)) : (
					<button
						type="button"
						onClick={() => onCreate(card.model_id)}
						className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white/80 px-4 py-8 text-sm font-medium text-gray-500 hover:border-blue-300 hover:text-blue-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
					>
						<PlusIcon className="h-5 w-5" />
						{t('clickToAdd')}
					</button>
				)}
			</div>
		</article>
	);
}
