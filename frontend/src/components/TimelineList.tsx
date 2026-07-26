/**
 * The chronological event list.
 *
 * Rows are rendered in the order the API returned them (already sorted by
 * `sequence`) — the frontend never reorders a timeline, since the sequence is
 * the engine's own output and the source of truth for what happens when.
 *
 * A date separator is inserted whenever the UTC calendar day changes, which is
 * how a multi-day plan stays readable without the frontend having to slice the
 * timeline into per-day logs itself.
 */
import { Fragment } from 'react';
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
import { Badge } from './ui/Badge';
import { DUTY_STATUS_COLORS, dutyStatusTone } from '../lib/statusStyles';
import { Card } from './ui/Card';

interface TimelineRowProps {
  event: TimelineEvent;
}

export function TimelineRow({ event }: TimelineRowProps) {
  const minutes = durationMinutes(event.start_time, event.end_time);

  return (
    <li className="relative flex gap-4 py-4 pl-6">
      {/* Status-coloured rail marker, aligned to the connector line. */}
      <span
        aria-hidden="true"
        className="absolute left-0 top-6 h-2.5 w-2.5 -translate-x-1/2 rounded-full ring-2 ring-slate-900"
        style={{ background: DUTY_STATUS_COLORS[event.duty_status] }}
      />

      <div className="w-24 shrink-0 tabular-nums">
        <div className="text-sm font-semibold text-slate-200">{formatTime(event.start_time)}</div>
        <div className="text-xs text-slate-500">{formatTime(event.end_time)}</div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-100">
            {eventTypeLabel(event.event_type)}
          </span>
          <Badge tone={dutyStatusTone(event.duty_status)}>
            {dutyStatusLabel(event.duty_status)}
          </Badge>
          <span className="text-xs font-medium text-slate-400">{formatDuration(minutes)}</span>
          {event.distance_miles && (
            <span className="text-xs text-slate-500">{formatDecimal(event.distance_miles)} mi</span>
          )}
        </div>
        <p className="mt-1 truncate text-sm text-slate-400" title={event.location_name}>
          {event.location_name}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{event.reason}</p>
      </div>

      <div className="hidden w-8 shrink-0 text-right text-xs tabular-nums text-slate-600 sm:block">
        {event.sequence}
      </div>
    </li>
  );
}

interface TimelineListProps {
  events: TimelineEvent[];
}

export function TimelineList({ events }: TimelineListProps) {
  if (events.length === 0) {
    return (
      <Card title="Timeline">
        <p className="text-sm text-slate-500">No timeline events.</p>
      </Card>
    );
  }

  return (
    <Card title="Timeline" action={<Badge>{events.length} events</Badge>}>
      {/* The connector line lives outside the list so <ol> has only <li> children. */}
      <div className="relative">
        <span aria-hidden="true" className="absolute bottom-0 left-0 top-0 w-px bg-slate-800" />
        <ol className="divide-y divide-slate-800">
          {events.map((event, index) => {
            const previous = index > 0 ? events[index - 1] : null;
            const newDay =
              index === 0 ||
              (previous && crossesDateBoundary(previous.start_time, event.start_time));

            return (
              <Fragment key={event.id ?? event.sequence}>
                {newDay && (
                  <li className="bg-slate-900/60 px-6 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {formatDate(event.start_time)}
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
