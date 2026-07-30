'use client';

import {
	CheckIcon,
	ChevronUpDownIcon,
	GlobeAltIcon,
} from '@heroicons/react/24/outline';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { locales, type Locale } from '@/lib/locale';

type Variant = 'sidebar' | 'login';

const shellClass: Record<Variant, string> = {
	sidebar:
		'flex w-full items-center gap-2 rounded-xl border border-gray-700/70 bg-gray-950/50 p-1 shadow-inner shadow-black/20',
	login:
		'flex w-full items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-1',
};

const iconWrapClass: Record<Variant, string> = {
	sidebar:
		'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-800/80 text-gray-400',
	login:
		'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-gray-500 shadow-sm ring-1 ring-gray-200/80',
};

const selectClass: Record<Variant, string> = {
	sidebar:
		'flex h-8 w-full cursor-pointer items-center rounded-lg bg-transparent py-1 pl-2 pr-8 text-left text-sm font-medium text-gray-200 outline-none transition-colors hover:bg-gray-800/70 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 disabled:cursor-not-allowed',
	login:
		'flex h-8 w-full cursor-pointer items-center rounded-lg bg-transparent py-1 pl-2 pr-8 text-left text-sm font-medium text-gray-800 outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed',
};

const chevronClass: Record<Variant, string> = {
	sidebar: 'text-gray-500',
	login: 'text-gray-400',
};

const menuClass: Record<Variant, string> = {
	sidebar:
		'absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-lg border border-gray-700 bg-gray-900 p-1 shadow-xl shadow-black/30 ring-1 ring-black/20',
	login:
		'absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-gray-200 bg-white p-1 shadow-xl ring-1 ring-black/5',
};

const optionClass: Record<Variant, string> = {
	sidebar:
		'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm text-gray-300 outline-none transition hover:bg-gray-800 hover:text-white focus-visible:bg-gray-800 focus-visible:text-white',
	login:
		'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm text-gray-700 outline-none transition hover:bg-gray-100 hover:text-gray-900 focus-visible:bg-gray-100 focus-visible:text-gray-900',
};

const selectedOptionClass: Record<Variant, string> = {
	sidebar: 'bg-blue-500/15 font-semibold text-blue-200',
	login: 'bg-blue-50 font-semibold text-blue-700',
};

export default function LocaleSwitcher({ variant }: { variant: Variant }) {
	const t = useTranslations('locale');
	const locale = useLocale() as Locale;
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

	useEffect(() => {
		if (!open) return;

		const selectedIndex = locales.indexOf(locale);
		optionRefs.current[selectedIndex]?.focus();

		const closeOnOutsidePointer = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener('pointerdown', closeOnOutsidePointer);
		return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
	}, [locale, open]);

	const onSelect = (next: Locale) => {
		if (next === locale || isPending) return;
		startTransition(async () => {
			await fetch('/api/locale', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ locale: next }),
			});
			router.refresh();
		});
	};

	const chooseLocale = (next: Locale) => {
		setOpen(false);
		triggerRef.current?.focus();
		onSelect(next);
	};

	const focusOption = (index: number) => {
		const normalizedIndex = (index + locales.length) % locales.length;
		optionRefs.current[normalizedIndex]?.focus();
	};

	return (
		<div
			ref={rootRef}
			className={`${shellClass[variant]} ${isPending ? 'opacity-70' : ''}`}
			aria-busy={isPending}
		>
			<span className={iconWrapClass[variant]} aria-hidden>
				<GlobeAltIcon className="h-3.5 w-3.5" />
			</span>
			<div className="relative min-w-0 flex-1">
				<button
					ref={triggerRef}
					type="button"
					disabled={isPending}
					aria-label={t('label')}
					aria-haspopup="listbox"
					aria-expanded={open}
					onClick={() => setOpen((current) => !current)}
					onKeyDown={(event) => {
						if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
							event.preventDefault();
							setOpen(true);
						}
						if (event.key === 'Escape') setOpen(false);
					}}
					className={`${selectClass[variant]} ${isPending ? 'opacity-60' : ''}`}
				>
					<span className="truncate">{t(locale)}</span>
				</button>
				<ChevronUpDownIcon
					className={`pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 transition-transform ${open ? 'rotate-180' : ''} ${chevronClass[variant]}`}
					aria-hidden
				/>
				{open ? (
					<div role="listbox" aria-label={t('label')} className={menuClass[variant]}>
						{locales.map((code, index) => {
							const selected = code === locale;
							return (
								<button
									key={code}
									ref={(element) => {
										optionRefs.current[index] = element;
									}}
									type="button"
									role="option"
									aria-selected={selected}
									onClick={() => chooseLocale(code)}
									onKeyDown={(event) => {
										if (event.key === 'ArrowDown') {
											event.preventDefault();
											focusOption(index + 1);
										} else if (event.key === 'ArrowUp') {
											event.preventDefault();
											focusOption(index - 1);
										} else if (event.key === 'Home') {
											event.preventDefault();
											focusOption(0);
										} else if (event.key === 'End') {
											event.preventDefault();
											focusOption(locales.length - 1);
										} else if (event.key === 'Escape') {
											event.preventDefault();
											setOpen(false);
											triggerRef.current?.focus();
										}
									}}
									className={`${optionClass[variant]} ${selected ? selectedOptionClass[variant] : ''}`}
								>
									<span>{t(code)}</span>
									{selected ? <CheckIcon className="h-4 w-4 shrink-0" aria-hidden /> : null}
								</button>
							);
						})}
					</div>
				) : null}
			</div>
		</div>
	);
}
