import type { ReactNode } from 'react';
import type { BadgeTone } from '../../lib/statusStyles';

const TONES: Record<BadgeTone, string> = {
  brand: 'bg-blue-50 text-blue-700 ring-blue-200',
  success: 'bg-green-50 text-green-700 ring-green-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  driving: 'bg-blue-50 text-blue-700 ring-blue-200',
  onDuty: 'bg-amber-50 text-amber-700 ring-amber-200',
  offDuty: 'bg-slate-100 text-slate-600 ring-slate-200',
  sleeper: 'bg-violet-50 text-violet-700 ring-violet-200',
};

const SIZES = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
} as const;

interface BadgeProps {
  tone?: BadgeTone;
  size?: keyof typeof SIZES;
  /** Small leading dot, for statuses where colour alone carries meaning. */
  dot?: boolean;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', size = 'sm', dot = false, children }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full',
        'font-medium ring-1 ring-inset',
        TONES[tone],
        SIZES[size],
      ].join(' ')}
    >
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
