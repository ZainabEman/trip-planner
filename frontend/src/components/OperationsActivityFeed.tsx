/**
 * Operations activity, newest first.
 *
 * Not the HOS timeline: this is a log of planning operations across the fleet.
 * Every row links to its trip. See `lib/activityFeed.ts` for how each event is
 * derived from the two timestamps the API exposes, and why "Replanned" is
 * absent rather than guessed.
 */
import { CheckCircle2, FilePlus2, Route, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ActivityEvent, ActivityKind } from '../lib/activityFeed';
import { formatDateTime } from '../lib/format';
import { tripHref } from '../hooks/useHashRoute';

const STYLES: Record<ActivityKind, { icon: LucideIcon; chip: string }> = {
  created: { icon: FilePlus2, chip: 'bg-slate-100 text-slate-600' },
  route: { icon: Route, chip: 'bg-blue-50 text-blue-600' },
  completed: { icon: CheckCircle2, chip: 'bg-green-50 text-green-600' },
  failed: { icon: XCircle, chip: 'bg-red-50 text-red-600' },
};

export function OperationsActivityFeed({ events }: { events: ActivityEvent[] }) {
  return (
    <ol className="space-y-1">
      {events.map((event, index) => {
        const { icon: Icon, chip } = STYLES[event.kind];
        return (
          <li key={event.id}>
            <a
              href={tripHref(event.tripId)}
              className="group flex gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-slate-50"
            >
              <div className="flex flex-col items-center">
                <span
                  aria-hidden="true"
                  className={[
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                    chip,
                  ].join(' ')}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                {index < events.length - 1 && (
                  <span aria-hidden="true" className="mt-1 w-px flex-1 bg-gray-200" />
                )}
              </div>

              <div className="min-w-0 flex-1 pb-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="text-sm font-medium text-slate-900 group-hover:text-blue-700">
                    {event.title}
                  </p>
                  <p className="shrink-0 text-xs tabular-nums text-slate-500">
                    {formatDateTime(event.at)}
                    {/* Routing and planning share `updated_at`; say so rather
                        than implying a precision the API does not provide. */}
                    {!event.exact && <span className="text-slate-400"> (approx.)</span>}
                  </p>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500" title={event.detail}>
                  {event.detail}
                </p>
              </div>
            </a>
          </li>
        );
      })}
    </ol>
  );
}
