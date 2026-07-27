/**
 * The trip as a vertical journey.
 *
 * Rows render in the order the API returned them (already sorted by
 * `sequence`) — the frontend never reorders a timeline, since the sequence is
 * the engine's own output and the source of truth for what happens when.
 *
 * A date separator is inserted whenever the UTC calendar day changes, which
 * keeps a multi-day plan readable without the frontend slicing it into per-day
 * logs itself.
 */
import { Fragment } from 'react';
import { CalendarDays, MapPin } from 'lucide-react';
import type { TimelineEvent } from '../types/api';
import {
  crossesDateBoundary,
  durationMinutes,
  dutyStatusLabel,
  eventTypeLabel,
  formatDate,
  formatDecimal,
  formatDuration,
  formatTime,
} from '../lib/format';
import { eventMeta, extractRuleIds } from '../lib/eventMeta';
import { DUTY_STATUS_COLORS, dutyStatusTone } from '../lib/statusStyles';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { Disclosure } from './ui/Disclosure';
import { EmptyState } from './ui/EmptyState';

export function TimelineRow({ event }: { event: TimelineEvent }) {
  const minutes = durationMinutes(event.start_time, event.end_time);
  const { icon: Icon, plain } = eventMeta(event.event_type);
  const rules = extractRuleIds(event.reason);
  const accent = DUTY_STATUS_COLORS[event.duty_status];

  return (
    <li className="relative flex gap-4 py-5">
      {/* Journey node, centred on the connector rail. */}
      <span
        aria-hidden="true"
        className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 bg-white"
        style={{ borderColor: accent, color: accent }}
      >
        <Icon className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-base font-semibold text-slate-900">
            {eventTypeLabel(event.event_type)}
          </h3>
          <Badge tone={dutyStatusTone(event.duty_status)}>
            {dutyStatusLabel(event.duty_status)}
          </Badge>
        </div>

        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
          <span className="font-medium tabular-nums text-slate-900">
            {formatTime(event.start_time)} – {formatTime(event.end_time)}
          </span>
          <span aria-hidden="true" className="text-slate-300">
            •
          </span>
          <span className="tabular-nums">{formatDuration(minutes)}</span>
          {event.distance_miles && (
            <>
              <span aria-hidden="true" className="text-slate-300">
                •
              </span>
              <span className="tabular-nums">{formatDecimal(event.distance_miles)} mi</span>
            </>
          )}
        </p>

        <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
          <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate" title={event.location_name}>
            {event.location_name}
          </span>
        </p>

        {plain && <p className="mt-2 text-sm leading-relaxed text-slate-600">{plain}</p>}

        {rules.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {rules.map((rule) => (
              <span
                key={rule}
                className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-medium text-slate-600"
                title="Federal rule reference"
              >
                {rule}
              </span>
            ))}
          </div>
        )}

        <div className="mt-1">
          <Disclosure size="sm" summary="Details">
            <dl className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs">
              <div>
                <dt className="font-medium text-slate-500">Why this stop</dt>
                <dd className="mt-0.5 leading-relaxed text-slate-700">{event.reason}</dd>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <dt className="font-medium text-slate-500">Starts</dt>
                  <dd className="mt-0.5 tabular-nums text-slate-700">
                    {formatDate(event.start_time)} {formatTime(event.start_time)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Ends</dt>
                  <dd className="mt-0.5 tabular-nums text-slate-700">
                    {formatDate(event.end_time)} {formatTime(event.end_time)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Coordinates</dt>
                  <dd className="mt-0.5 tabular-nums text-slate-700">
                    {Number(event.latitude).toFixed(4)}, {Number(event.longitude).toFixed(4)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Sequence</dt>
                  <dd className="mt-0.5 tabular-nums text-slate-700">#{event.sequence}</dd>
                </div>
              </div>
            </dl>
          </Disclosure>
        </div>
      </div>
    </li>
  );
}

export function TimelineList({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <Card title="Timeline">
        <EmptyState
          illustration="timeline"
          title="No timeline available"
          description="Once a trip is planned, every driving period, break and stop appears here in order."
          compact
        />
      </Card>
    );
  }

  return (
    <Card
      title="Timeline"
      description="Every duty period, in order"
      action={<Badge>{events.length} events</Badge>}
    >
      {/* The rail sits behind the nodes; <ol> keeps only <li> children. */}
      <div className="relative">
        <span
          aria-hidden="true"
          className="absolute bottom-5 left-5 top-5 w-px -translate-x-1/2 bg-gray-200"
        />
        <ol className="divide-y divide-gray-100">
          {events.map((event, index) => {
            const previous = index > 0 ? events[index - 1] : null;
            const newDay =
              index === 0 ||
              (previous && crossesDateBoundary(previous.start_time, event.start_time));

            return (
              <Fragment key={event.id ?? event.sequence}>
                {newDay && (
                  <li className="relative z-10 -mx-5 bg-white px-5 pt-4">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />
                      {formatDate(event.start_time)}
                    </p>
                  </li>
                )}
                <TimelineRow event={event} />
              </Fragment>
            );
          })}
        </ol>
      </div>
    </Card>
  );
}
