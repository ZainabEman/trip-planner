import type { ReactNode } from 'react';
import type { BadgeTone } from '../../lib/statusStyles';

const TONES: Record<BadgeTone, string> = {
  driving: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  onDuty: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  offDuty: 'bg-slate-500/15 text-slate-300 ring-slate-500/30',
  sleeper: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  success: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  danger: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  neutral: 'bg-slate-500/15 text-slate-300 ring-slate-500/30',
};

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5',
        'text-xs font-medium ring-1 ring-inset',
        TONES[tone],
      ].join(' ')}
    >
      {children}
    </span>
  );
}
