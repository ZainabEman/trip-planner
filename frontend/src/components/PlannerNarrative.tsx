/**
 * What the planner did, step by step.
 *
 * The companion to `PlanningActivityLog`, which reports the *request* stages
 * (trip created → route generated → rules checked → timeline built). This
 * reports the *scheduling decisions* inside the last of those stages: each
 * driving segment completed, each break or reset inserted, each resumption, and
 * the arrival.
 *
 * Every entry corresponds to a real timeline event — see `lib/planAnalysis.ts`
 * for the mapping and for why this is reconstructed from the timeline rather
 * than served by the API.
 *
 * Entries that map to an event are clickable, which highlights that event in
 * the timeline and the duty graph. The three that do not — trip created, route
 * generated, and a failure notice — render as plain rows.
 */
import {
  BedDouble,
  CheckCircle2,
  Coffee,
  Flag,
  FilePlus2,
  Fuel,
  Play,
  RotateCcw,
  Route as RouteIcon,
  Truck,
  TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NarrativeEntry } from '../lib/planAnalysis';
import { formatTime } from '../lib/format';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';

/** Icon and accent per narrative step. */
const STYLE: Record<NarrativeEntry['kind'], { icon: LucideIcon; dot: string; text: string }> = {
  created: { icon: FilePlus2, dot: 'bg-slate-400', text: 'text-slate-700' },
  routed: { icon: RouteIcon, dot: 'bg-slate-400', text: 'text-slate-700' },
  driving: { icon: Truck, dot: 'bg-blue-500', text: 'text-slate-900' },
  remedy: { icon: Coffee, dot: 'bg-amber-500', text: 'text-slate-900' },
  resumed: { icon: Play, dot: 'bg-green-500', text: 'text-slate-600' },
  arrived: { icon: Flag, dot: 'bg-green-600', text: 'text-slate-900' },
  failed: { icon: TriangleAlert, dot: 'bg-red-600', text: 'text-red-700' },
};

/** A remedy's icon depends on which remedy it was; the label carries the name. */
function remedyIcon(label: string): LucideIcon {
  if (label.startsWith('10-hour')) return BedDouble;
  if (label.startsWith('34-hour')) return RotateCcw;
  if (label.startsWith('Fuel')) return Fuel;
  return Coffee;
}

interface PlannerNarrativeProps {
  entries: NarrativeEntry[];
  selectedSequence?: number | null;
  onSelect?: (sequence: number | null) => void;
}

export function PlannerNarrative({
  entries,
  selectedSequence = null,
  onSelect,
}: PlannerNarrativeProps) {
  if (entries.length === 0) {
    return (
      <Card title="Planner decisions">
        <EmptyState
          illustration="timeline"
          title="No planning decisions recorded"
          description="Plan a trip and every driving segment, break and reset the planner schedules will be listed here in order."
          compact
        />
      </Card>
    );
  }

  const remedies = entries.filter((entry) => entry.kind === 'remedy').length;

  return (
    <Card
      title="Planner decisions"
      description={
        remedies > 0
          ? `${entries.length} steps · ${remedies} rest or fuel stop${remedies === 1 ? '' : 's'} inserted automatically`
          : `${entries.length} steps · no rest needed`
      }
    >
      <ol className="space-y-0">
        {entries.map((entry, index) => {
          const style = STYLE[entry.kind];
          const Icon = entry.kind === 'remedy' ? remedyIcon(entry.label) : style.icon;
          const selectable = entry.sequence !== undefined && onSelect !== undefined;
          const selected = entry.sequence !== undefined && entry.sequence === selectedSequence;
          const last = index === entries.length - 1;

          const body = (
            <>
              <p
                className={[
                  'text-sm font-medium',
                  selected ? 'text-blue-800' : style.text,
                  entry.kind === 'resumed' ? 'italic' : '',
                ].join(' ')}
              >
                {entry.label}
                {entry.ruleId && (
                  <span className="ml-2 rounded border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-600">
                    {entry.ruleId}
                  </span>
                )}
              </p>
              {entry.detail && (
                <p className="mt-0.5 truncate text-xs text-slate-500" title={entry.detail}>
                  {entry.detail}
                </p>
              )}
            </>
          );

          return (
            <li key={entry.id} className="flex gap-3">
              {/* Marker column, with the connector running between markers. */}
              <div className="flex flex-col items-center">
                <span
                  aria-hidden="true"
                  className={[
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white',
                    style.dot,
                  ].join(' ')}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                {!last && <span aria-hidden="true" className="w-0.5 flex-1 bg-gray-200" />}
              </div>

              <div className={['min-w-0 flex-1', last ? '' : 'pb-4'].join(' ')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {selectable ? (
                      <button
                        type="button"
                        onClick={() => onSelect(selected ? null : entry.sequence!)}
                        aria-pressed={selected}
                        // `print-keep`: this button *is* the step's text, so the
                        // blanket "hide buttons when printing" rule must not
                        // apply to it. See index.css.
                        className={[
                          'print-keep block w-full rounded-md px-2 py-1 text-left transition-colors -ml-2',
                          selected ? 'bg-blue-50' : 'hover:bg-slate-50',
                        ].join(' ')}
                      >
                        {body}
                      </button>
                    ) : (
                      body
                    )}
                  </div>
                  {entry.at && (
                    <time
                      dateTime={entry.at}
                      className="shrink-0 pt-1 text-xs tabular-nums text-slate-400"
                    >
                      {formatTime(entry.at)}
                    </time>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {entries[entries.length - 1]?.kind === 'arrived' && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">
          <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
          Delivery reached within the hours-of-service limits
        </p>
      )}
    </Card>
  );
}
