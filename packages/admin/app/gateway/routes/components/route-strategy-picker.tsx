'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { RouteStrategyName } from '@octafuse/core';
import { ROUTE_STRATEGY_META_LIST } from '../route-strategy-meta';
import { RouteStrategyDiagram } from './route-strategy-diagram';

export type RouteStrategyPickerProps = {
	/** Currently selected strategy id, or '' for inherit. */
	value: string;
	onChange: (value: string) => void;
	/** When set, empty selection shows inherit → this strategy. */
	allowInherit?: boolean;
	inheritedStrategy?: string;
	inheritedSourceLabel?: string;
	disabled?: boolean;
	className?: string;
	/** Compact density for Config page. */
	dense?: boolean;
};

function strategyTitleKey(id: RouteStrategyName): `display.${RouteStrategyName}` {
	return `display.${id}`;
}

export function RouteStrategyPicker(props: RouteStrategyPickerProps) {
	const {
		value,
		onChange,
		allowInherit = false,
		inheritedStrategy,
		inheritedSourceLabel,
		disabled = false,
		className,
		dense = false,
	} = props;
	const t = useTranslations('routes.strategy');
	const groupId = useId();
	const [hovered, setHovered] = useState<string | null>(null);

	const effective =
		value || (allowInherit && inheritedStrategy ? inheritedStrategy : value);

	const selectStrategy = (next: string) => {
		if (disabled) return;
		onChange(next);
	};

	return (
		<div className={className}>
			{allowInherit ? (
				<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
					{inheritedStrategy ? (
						<p className="text-xs text-gray-500">
							<span className="font-medium text-gray-600">{t('inheritedResult')}</span>
							<span className="mx-1.5 text-gray-300">·</span>
							<span className="font-mono text-gray-700">{inheritedStrategy}</span>
							{inheritedSourceLabel ? (
								<>
									<span className="mx-1.5 text-gray-300">·</span>
									<span>{inheritedSourceLabel}</span>
								</>
							) : null}
						</p>
					) : (
						<span />
					)}
					<button
						type="button"
						onClick={() => selectStrategy('')}
						disabled={disabled}
						aria-pressed={!value}
						className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-semibold ring-1 ring-inset transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${
							!value
								? 'bg-indigo-50 text-indigo-700 ring-indigo-200'
								: 'bg-white text-gray-600 ring-gray-200 hover:bg-gray-50 hover:text-indigo-700'
						}`}
					>
						{t('inherit')}
					</button>
				</div>
			) : null}

			<div
				role="radiogroup"
				aria-labelledby={`${groupId}-label`}
				className="grid gap-3 sm:grid-cols-2"
			>
				<span id={`${groupId}-label`} className="sr-only">
					{t('guideTitle')}
				</span>
				{ROUTE_STRATEGY_META_LIST.map((meta) => {
					const selected = effective === meta.id;
					const usingInherit = selected && allowInherit && !value;
					const showMotion = selected || hovered === meta.id;
					return (
						<button
							key={meta.id}
							type="button"
							role="radio"
							aria-checked={selected}
							disabled={disabled}
							onClick={() => selectStrategy(meta.id)}
							onMouseEnter={() => setHovered(meta.id)}
							onMouseLeave={() => setHovered((cur) => (cur === meta.id ? null : cur))}
							onFocus={() => setHovered(meta.id)}
							onBlur={() => setHovered((cur) => (cur === meta.id ? null : cur))}
							className={`flex h-full flex-col items-stretch justify-start rounded-lg border p-3.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${
								selected
									? 'border-indigo-300 bg-indigo-50/70 ring-1 ring-inset ring-indigo-200'
									: 'border-gray-200 bg-white hover:border-indigo-200 hover:bg-slate-50'
							}`}
						>
							<div className="relative min-h-[2.5rem] pr-24">
								<div className="truncate text-sm font-semibold leading-5 text-gray-900">
									{t(strategyTitleKey(meta.id))}
								</div>
								<div className="mt-0.5 truncate font-mono text-[10px] leading-4 text-gray-400">
									{meta.machineId}
								</div>
								<span className="absolute right-0 top-0 flex flex-col items-end gap-1">
									{meta.recommended ? (
										<span className="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-amber-800">
											{t('recommended')}
										</span>
									) : null}
									{usingInherit ? (
										<span className="whitespace-nowrap rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-indigo-700">
											{t('inherit')}
										</span>
									) : null}
									{selected ? (
										<span className="whitespace-nowrap rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold leading-4 text-emerald-700">
											{t('effective')}
										</span>
									) : null}
								</span>
							</div>

							<div className="mt-2.5">
								<RouteStrategyDiagram
									kind={meta.diagram}
									active={showMotion}
									caption={t(`diagramCaption.${meta.id}`)}
								/>
							</div>

							<p className={`mt-2 leading-relaxed text-gray-600 ${dense ? 'text-[11px]' : 'text-xs'}`}>
								{t(`description.${meta.id}.summary`)}
							</p>
							<p className="mt-1 text-[11px] leading-relaxed text-gray-500">
								<span className="font-medium text-gray-600">{t('bestFor')}</span>
								{t('labelSeparator')}
								{t(`description.${meta.id}.bestFor`)}
							</p>
							<p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
								<span className="font-medium text-gray-600">{t('tradeoff')}</span>
								{t('labelSeparator')}
								{t(`description.${meta.id}.tradeoff`)}
							</p>
						</button>
					);
				})}
			</div>
		</div>
	);
}
