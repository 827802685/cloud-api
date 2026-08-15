'use client';

/**
 * 通用进度条组件。
 * - `active` 为 false 时不渲染任何内容（调用方无需额外条件判断）。
 * - `value` 提供时渲染确定进度（0-100）；缺省渲染不确定进度（滑动动画）。
 * - `label` / `detail` 显示在进度条上方（如「正在删除模型...」+「3/10」）。
 */
type ProgressBarColor = 'blue' | 'red' | 'green' | 'amber' | 'sky' | 'emerald';

const COLOR_CLASS: Record<ProgressBarColor, string> = {
	blue: 'bg-blue-500',
	red: 'bg-red-500',
	green: 'bg-green-500',
	amber: 'bg-amber-500',
	sky: 'bg-sky-500',
	emerald: 'bg-emerald-500',
};

export type ProgressBarProps = {
	active?: boolean;
	label?: string;
	detail?: string;
	/** 确定进度 0-100；缺省为不确定（滑动动画）。 */
	value?: number;
	color?: ProgressBarColor;
	/** 进度条轨道高度（px），默认 2。 */
	height?: number;
	className?: string;
};

export function ProgressBar(props: ProgressBarProps) {
	const {
		active = false,
		label,
		detail,
		value,
		color = 'blue',
		height = 2,
		className = '',
	} = props;

	if (!active) return null;

	const isDeterminate = typeof value === 'number' && Number.isFinite(value);
	const clamped = isDeterminate ? Math.max(0, Math.min(100, value as number)) : 0;
	const barColor = COLOR_CLASS[color] ?? COLOR_CLASS.blue;

	return (
		<div className={className} role="progressbar" aria-valuenow={isDeterminate ? clamped : undefined}>
			{(label || detail) && (
				<div className="mb-1 flex items-center justify-between gap-3 text-xs">
					{label ? <span className="truncate text-gray-600">{label}</span> : <span />}
					{detail ? <span className="shrink-0 font-medium text-gray-500">{detail}</span> : null}
				</div>
			)}
			<div
				className="relative w-full overflow-hidden rounded-full bg-gray-100"
				style={{ height }}
			>
				{isDeterminate ? (
					<div
						className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out ${barColor}`}
						style={{ width: `${clamped}%` }}
					/>
				) : (
					<div
						className={`absolute inset-y-0 left-0 w-1/3 rounded-full ${barColor} animate-[progress-slide_1.2s_ease-in-out_infinite]`}
					/>
				)}
			</div>
		</div>
	);
}
