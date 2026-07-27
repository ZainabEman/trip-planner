import type { ReactNode } from 'react';

interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Small trailing unit, kept visually subordinate to the value. */
  unit?: string;
  icon?: ReactNode;
  /** Draw attention to the trip's headline figure. */
  emphasis?: boolean;
}

export function StatTile({ label, value, unit, icon, emphasis = false }: StatTileProps) {
  return (
    <div
      className={[
        'rounded-lg border px-4 py-3.5',
        emphasis ? 'border-blue-200 bg-blue-50/60' : 'border-gray-200 bg-white',
      ].join(' ')}
    >
      <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {icon && (
          <span aria-hidden="true" className={emphasis ? 'text-blue-600' : 'text-slate-400'}>
            {icon}
          </span>
        )}
        {label}
      </dt>
      <dd className="mt-1.5 flex items-baseline gap-1">
        <span
          className={[
            'text-2xl font-semibold tabular-nums tracking-tight',
            emphasis ? 'text-blue-700' : 'text-slate-900',
          ].join(' ')}
        >
          {value}
        </span>
        {unit && <span className="text-sm font-medium text-slate-500">{unit}</span>}
      </dd>
    </div>
  );
}
