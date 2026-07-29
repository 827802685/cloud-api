'use client';

import {
	ArrowLongRightIcon,
	ArrowPathRoundedSquareIcon,
	CloudIcon,
	CursorArrowRaysIcon,
	MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';

const STEPS = [
	{ key: 'request', icon: CursorArrowRaysIcon },
	{ key: 'lookup', icon: MagnifyingGlassIcon },
	{ key: 'policy', icon: ArrowPathRoundedSquareIcon },
	{ key: 'provider', icon: CloudIcon },
] as const;

export function RouteFlowOverview() {
	const t = useTranslations('routes.flow');

	return (
		<div className="mb-5 overflow-hidden rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50/90 via-white to-emerald-50/70 p-4 shadow-sm">
			<div className="mb-3">
				<h3 className="text-sm font-semibold text-gray-900">{t('overviewTitle')}</h3>
				<p className="mt-0.5 text-xs text-gray-500">{t('overviewHint')}</p>
			</div>
			<div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] sm:items-center">
				{STEPS.map(({ key, icon: Icon }, index) => (
					<div key={key} className="contents">
						<div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-white/90 bg-white/85 px-3 py-2 shadow-sm">
							<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600 ring-1 ring-inset ring-blue-100">
								<Icon className="h-4 w-4" />
							</span>
							<div className="min-w-0">
								<p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">
									{t('step', { number: index + 1 })}
								</p>
								<p className="truncate text-xs font-semibold text-gray-800">{t(`${key}Step`)}</p>
							</div>
						</div>
						{index < STEPS.length - 1 ? (
							<ArrowLongRightIcon className="mx-auto hidden h-5 w-5 text-blue-300 sm:block" />
						) : null}
					</div>
				))}
			</div>
		</div>
	);
}
