import type { ReactNode } from 'react';

interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Small trailing unit, kept visually subordinate to the value. */
  unit?: string;
}

export function StatTile({ label, value, unit }: StatTileProps) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1">
        <span className="text-xl font-semibold tabular-nums text-slate-100">{value}</span>
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </dd>
    </div>
  );
}
