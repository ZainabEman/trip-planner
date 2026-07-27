/**
 * The trip as a vertical journey.
 *
 * Rows render in the order the API returned them (already sorted by `sequence`)
 * — the frontend never reorders a timeline, since the sequence is the engine's
 * own output and the source of truth for what happens when.
 *
 * Date separators are **sticky**: on a multi-day plan the day you are reading
 * stays pinned at the top of the panel while you scroll through its events,
 * which is the difference between a scannable schedule and a wall of times.
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
import { CopyButton } from './ui/CopyButton';
import { Disclosure } from './ui/Disclosure';
import { EmptyState } from './ui/EmptyState';

export function TimelineRow({ event }: { event: TimelineEvent }) {
  const minutes = durationMinutes(event.start_time, event.end_time);
  const { icon: Icon, plain } = eventMeta(event.event_type);
  const rules = extractRuleIds(event.reason);
  const accent = DUTY_STATUS_COLORS[event.duty_status];
  const coordinates = `${Number(event.latitude).toFixed(6)}, ${Number(event.longitude).toFixed(6)}`;

  return (
    <li className="relative flex gap-4 py-5">
      {/* Journey node, centred on the connector rail. */}
      <span
        aria-hidden="true"
        data-print-color
        className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 bg-white"
        style={{ borderColor: accent, color: accent }}
      >
        <Icon className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        {/* Title row: what it is, and its duty classification. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 className="text-base font-semibold leading-tight text-slate-900">
            {eventTypeLabel(event.event_type)}
          </h3>
          <Badge tone={dutyStatusTone(event.duty_status)} dot>
            {dutyStatusLabel(event.duty_status)}
          </Badge>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-slate-400">
            #{event.sequence}
          </span>
        </div>

        {/* Times and magnitudes, on one tabular line. */}
        <p className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
          <span className="font-semibold tabular-nums text-slate-900">
            {formatTime(event.start_time)} – {formatTime(event.end_time)}
          </span>
          <span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-slate-300" />
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium tabular-nums text-slate-700">
            {formatDuration(minutes)}
          </span>
          {event.distance_miles && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium tabular-nums text-slate-700">
              {formatDecimal(event.distance_miles)} mi
            </span>
          )}
        </p>

        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-slate-600">
          <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="truncate" title={event.location_name}>
            {event.location_name}
          </span>
        </p>

        {plain && <p className="mt-2 text-sm leading-relaxed text-slate-600">{plain}</p>}

        {rules.length > 0 && (
          <ul className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {rules.map((rule) => (
              <li key={rule}>
                <span
                  className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 font-mono text-xs font-medium text-slate-600"
                  title={`Federal business rule ${rule}`}
                >
                  {rule}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2">
          <Disclosure size="sm" summary="Details">
            <dl className="space-y-2.5 rounded-lg bg-slate-50 p-3 text-xs">
              <div>
                <dt className="font-medium text-slate-500">Why this stop</dt>
                <dd className="mt-0.5 leading-relaxed text-slate-700">{event.reason}</dd>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
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
                <div className="col-span-2">
                  <dt className="font-medium text-slate-500">Coordinates</dt>
                  <dd className="mt-0.5 flex items-center gap-1">
                    <span className="font-mono tabular-nums text-slate-700">{coordinates}</span>
                    <span className="no-print">
                      <CopyButton value={coordinates} what="coordinates" />
                    </span>
                  </dd>
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

  const days = new Set(events.map((event) => formatDate(event.start_time))).size;

  return (
    <Card
      title="Timeline"
      description={`${events.length} events across ${days} day${days === 1 ? '' : 's'}`}
      action={<Badge tone="brand">{events.length} events</Badge>}
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
                  // Sticky so the current day stays visible while scrolling.
                  // `-mx-5 px-5` bleeds it to the card edges; the opaque
                  // background stops the rail and rows showing through.
                  <li className="sticky top-0 z-20 -mx-5 border-y border-gray-100 bg-slate-50 px-5 py-2">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
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
