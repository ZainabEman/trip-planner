/**
 * The single most important line on the page: is this trip legal, and when does
 * it arrive.
 *
 * Sits above the summary so the answer is visible without reading anything
 * else. Uses an icon *and* a word alongside the colour, so the legal/not-legal
 * distinction never depends on colour perception alone.
 */
import { AlertTriangle, CalendarRange, CheckCircle2, Clock, HelpCircle, Loader2 } from 'lucide-react';
import type { TripPlan } from '../types/api';
import { formatDateTime } from '../lib/format';
import { analysePlan } from '../lib/planAnalysis';

/**
 * `unplanned` is deliberately separate from `illegal`.
 *
 * A trip with no schedule is not the same as a trip that cannot legally have
 * one, and the two used to share a red "Trip cannot be completed legally"
 * banner. That misattributed every routing failure — an unroutable location or
 * a provider outage leaves the trip unplanned without any rule having been
 * broken — as an hours-of-service violation, which is both wrong and the
 * opposite of actionable.
 */
type Kind = 'legal' | 'illegal' | 'unplanned' | 'planning';

interface TripStatusBarProps {
  kind: Kind;
  plan?: TripPlan | null;
  /** Short reason, shown when the trip cannot be driven legally. */
  reason?: string;
}

const STYLES: Record<Kind, { wrap: string; chip: string; icon: typeof CheckCircle2 }> = {
  legal: {
    wrap: 'border-green-200 bg-green-50',
    chip: 'bg-green-600 text-white',
    icon: CheckCircle2,
  },
  illegal: {
    wrap: 'border-red-200 bg-red-50',
    chip: 'bg-red-600 text-white',
    icon: AlertTriangle,
  },
  unplanned: {
    wrap: 'border-amber-200 bg-amber-50',
    chip: 'bg-amber-600 text-white',
    icon: HelpCircle,
  },
  planning: {
    wrap: 'border-blue-200 bg-blue-50',
    chip: 'bg-blue-600 text-white',
    icon: Loader2,
  },
};

const HEADLINES: Record<Kind, string> = {
  legal: 'Legal',
  illegal: 'Not legal',
  unplanned: 'Not planned',
  planning: 'Planning',
};

export function TripStatusBar({ kind, plan, reason }: TripStatusBarProps) {
  const style = STYLES[kind];
  const Icon = style.icon;
  const timeline = plan?.timeline ?? [];
  const arrival = timeline.length > 0 ? timeline[timeline.length - 1].end_time : null;
  const composition = timeline.length > 0 ? analysePlan(timeline) : null;

  return (
    <section
      aria-label="Trip status"
      // Announced when the outcome changes, so a screen-reader user is told the
      // verdict without hunting for it.
      aria-live="polite"
      className={['rounded-xl border px-5 py-4', style.wrap].join(' ')}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <span
            className={[
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
              style.chip,
            ].join(' ')}
          >
            <Icon
              aria-hidden="true"
              className={['h-5 w-5', kind === 'planning' ? 'animate-spin' : ''].join(' ')}
            />
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-slate-900">
              {kind === 'legal' && 'This trip can be driven legally'}
              {kind === 'illegal' && 'Trip cannot be completed legally'}
              {kind === 'unplanned' && 'This trip has no schedule yet'}
              {kind === 'planning' && 'Building your schedule…'}
            </p>
            <p className="mt-0.5 text-sm text-slate-600">
              {kind === 'legal' &&
                (composition?.hasRemedies
                  ? `The schedule below meets the federal hours-of-service limits across ${composition.days} day${composition.days === 1 ? '' : 's'}, with the required rest inserted automatically.`
                  : 'The schedule below meets the federal hours-of-service limits.')}
              {kind === 'illegal' && (reason ?? 'No schedule exists that stays within the limits.')}
              {kind === 'unplanned' &&
                (reason ?? 'Run the planner to produce a route and a legal schedule.')}
              {kind === 'planning' && 'Checking the route against the hours-of-service rules.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {composition && kind === 'legal' && (
            <div className="text-right">
              <p className="flex items-center justify-end gap-1.5 text-xs font-medium text-slate-500">
                <CalendarRange aria-hidden="true" className="h-3.5 w-3.5" />
                Schedule
              </p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                {composition.days} day{composition.days === 1 ? '' : 's'}
              </p>
            </div>
          )}
          {arrival && kind === 'legal' && (
            <div className="text-right">
              <p className="flex items-center justify-end gap-1.5 text-xs font-medium text-slate-500">
                <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                Projected arrival
              </p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                {formatDateTime(arrival)}
              </p>
            </div>
          )}
          <span
            className={[
              'inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold',
              style.chip,
            ].join(' ')}
          >
            {HEADLINES[kind]}
          </span>
        </div>
      </div>
    </section>
  );
}
