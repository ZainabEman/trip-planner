/**
 * A single headline count for the dashboard.
 *
 * Renders as a link when `href` is given, so "Failed trips: 3" takes a
 * dispatcher straight to the filtered history rather than making them
 * re-select the filter themselves.
 */
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';

export type KpiTone = 'neutral' | 'brand' | 'success' | 'danger' | 'warning';

const VALUE_TONES: Record<KpiTone, string> = {
  neutral: 'text-slate-900',
  brand: 'text-blue-700',
  success: 'text-green-700',
  danger: 'text-red-700',
  warning: 'text-amber-700',
};

const ICON_TONES: Record<KpiTone, string> = {
  neutral: 'bg-slate-100 text-slate-500',
  brand: 'bg-blue-50 text-blue-600',
  success: 'bg-green-50 text-green-600',
  danger: 'bg-red-50 text-red-600',
  warning: 'bg-amber-50 text-amber-600',
};

interface KpiCardProps {
  label: string;
  value: ReactNode;
  /** Small suffix, e.g. `%`. */
  unit?: string;
  hint?: string;
  icon: ReactNode;
  tone?: KpiTone;
  href?: string;
}

export function KpiCard({ label, value, unit, hint, icon, tone = 'neutral', href }: KpiCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <span
          aria-hidden="true"
          className={['flex h-8 w-8 items-center justify-center rounded-lg', ICON_TONES[tone]].join(
            ' ',
          )}
        >
          {icon}
        </span>
      </div>
      <p className="mt-3 flex items-baseline gap-1">
        <span
          className={['text-3xl font-semibold tabular-nums tracking-tight', VALUE_TONES[tone]].join(
            ' ',
          )}
        >
          {value}
        </span>
        {unit && <span className="text-base font-medium text-slate-400">{unit}</span>}
      </p>
      {hint && (
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
          {hint}
          {href && (
            <ArrowRight
              aria-hidden="true"
              className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
            />
          )}
        </p>
      )}
    </>
  );

  const base = 'rounded-xl border border-gray-200 bg-white p-5 shadow-sm';

  if (!href) {
    return <div className={base}>{body}</div>;
  }
  return (
    <a href={href} className={`group block transition-colors hover:border-blue-300 ${base}`}>
      {body}
    </a>
  );
}
