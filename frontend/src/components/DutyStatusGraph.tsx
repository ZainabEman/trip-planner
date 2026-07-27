/**
 * Duty-status graph — the shape a driver recognises from a paper log.
 *
 * Four lanes (Off Duty / Sleeper / Driving / On Duty), time running left to
 * right, each event drawn as a horizontal segment in its lane. Built entirely
 * from the timeline the API already returns — no extra request, no new field.
 *
 * One row per calendar day, because that is how logs are kept and how a
 * multi-day trip stays readable. An event crossing midnight is split across the
 * two days it touches; the underlying event is untouched, only its drawing.
 *
 * Positioning is percentage-based so the graph is fluid: it reflows on a phone
 * without a horizontal scrollbar, which a fixed-pixel Gantt would not.
 */
import { useMemo, useState } from 'react';
import type { DutyStatus, TimelineEvent } from '../types/api';
import { dutyStatusLabel, eventTypeLabel, formatDuration, formatTime } from '../lib/format';
import { DUTY_STATUS_COLORS } from '../lib/statusStyles';
import { eventMeta } from '../lib/eventMeta';
import { Card } from './ui/Card';
import { EmptyState } from './ui/EmptyState';

/** Lane order matches the FMCSA grid: Off Duty at the top, On Duty at the bottom. */
const LANES: DutyStatus[] = ['off_duty', 'sleeper_berth', 'driving', 'on_duty_not_driving'];

const LANE_SHORT: Record<DutyStatus, string> = {
  off_duty: 'OFF',
  sleeper_berth: 'SB',
  driving: 'D',
  on_duty_not_driving: 'ON',
};

const DAY_MS = 86_400_000;

interface Segment {
  event: TimelineEvent;
  /** Percentage offsets within the day, 0–100. */
  left: number;
  width: number;
  /** True when the event continues beyond this day's slice. */
  continues: boolean;
  startsEarlier: boolean;
}

interface DayRow {
  key: string;
  /** Midnight UTC for this day. */
  dayStart: number;
  label: string;
  segments: Segment[];
}

function utcDayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

const DAY_LABEL = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/**
 * Slice events into per-day rows.
 *
 * The engine emits one continuous event across midnight (a 10-hour rest, say),
 * so the split happens here at render time rather than in the data.
 */
function buildRows(events: TimelineEvent[]): DayRow[] {
  const rows = new Map<number, DayRow>();

  for (const event of events) {
    const start = new Date(event.start_time).getTime();
    const end = new Date(event.end_time).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    for (let day = utcDayStart(start); day < end; day += DAY_MS) {
      const dayEnd = day + DAY_MS;
      const sliceStart = Math.max(start, day);
      const sliceEnd = Math.min(end, dayEnd);
      if (sliceEnd <= sliceStart) continue;

      if (!rows.has(day)) {
        rows.set(day, {
          key: String(day),
          dayStart: day,
          label: DAY_LABEL.format(new Date(day)),
          segments: [],
        });
      }
      rows.get(day)!.segments.push({
        event,
        left: ((sliceStart - day) / DAY_MS) * 100,
        width: ((sliceEnd - sliceStart) / DAY_MS) * 100,
        continues: end > dayEnd,
        startsEarlier: start < day,
      });
    }
  }

  return [...rows.values()].sort((a, b) => a.dayStart - b.dayStart);
}

/** Six-hour ticks — enough to orient without crowding a narrow screen. */
const TICKS = [0, 25, 50, 75, 100];
const TICK_LABELS = ['00', '06', '12', '18', '24'];

interface DutyStatusGraphProps {
  events: TimelineEvent[];
  /** Sequence of the event highlighted elsewhere, to keep views in step. */
  selectedSequence?: number | null;
  onSelect?: (event: TimelineEvent | null) => void;
}

export function DutyStatusGraph({ events, selectedSequence, onSelect }: DutyStatusGraphProps) {
  const rows = useMemo(() => buildRows(events), [events]);
  const [hovered, setHovered] = useState<number | null>(null);

  if (events.length === 0) {
    return (
      <Card title="Duty status graph">
        <EmptyState
          illustration="timeline"
          title="No duty graph available"
          description="Plan a trip and its duty periods will be charted here, day by day."
          compact
        />
      </Card>
    );
  }

  const active = hovered ?? selectedSequence ?? null;

  return (
    <Card
      title="Duty status graph"
      description={`${rows.length} day${rows.length === 1 ? '' : 's'}, 00:00–24:00 UTC`}
    >
      <div className="space-y-5">
        {rows.map((row) => (
          <section key={row.key} aria-label={`Duty status for ${row.label}`}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {row.label}
            </h3>

            <div className="flex gap-2">
              {/* Lane labels */}
              <ul className="w-9 shrink-0 space-y-1" aria-hidden="true">
                {LANES.map((lane) => (
                  <li
                    key={lane}
                    className="flex h-7 items-center justify-end pr-1 text-[10px] font-semibold tabular-nums text-slate-500"
                  >
                    {LANE_SHORT[lane]}
                  </li>
                ))}
              </ul>

              {/* Grid + segments */}
              <div className="relative min-w-0 flex-1">
                <div className="space-y-1">
                  {LANES.map((lane) => (
                    <div
                      key={lane}
                      className="relative h-7 rounded border border-gray-200 bg-slate-50"
                    >
                      {/* Six-hour gridlines */}
                      {TICKS.slice(1, -1).map((tick) => (
                        <span
                          key={tick}
                          aria-hidden="true"
                          className="absolute top-0 h-full w-px bg-gray-200"
                          style={{ left: `${tick}%` }}
                        />
                      ))}

                      {row.segments
                        .filter((segment) => segment.event.duty_status === lane)
                        .map((segment) => {
                          const { event } = segment;
                          const { icon: Icon } = eventMeta(event.event_type);
                          const isActive = active === event.sequence;
                          const minutes =
                            (new Date(event.end_time).getTime() -
                              new Date(event.start_time).getTime()) /
                            60000;

                          return (
                            <button
                              key={`${event.sequence}-${row.key}`}
                              type="button"
                              onMouseEnter={() => setHovered(event.sequence)}
                              onMouseLeave={() => setHovered(null)}
                              onFocus={() => setHovered(event.sequence)}
                              onBlur={() => setHovered(null)}
                              onClick={() => onSelect?.(isActive ? null : event)}
                              title={`${eventTypeLabel(event.event_type)} · ${formatTime(event.start_time)}–${formatTime(event.end_time)} · ${formatDuration(minutes)} · ${event.location_name}`}
                              aria-label={`${eventTypeLabel(event.event_type)}, ${dutyStatusLabel(event.duty_status)}, ${formatTime(event.start_time)} to ${formatTime(event.end_time)}, ${formatDuration(minutes)}, at ${event.location_name}`}
                              data-print-color
                              className={[
                                'absolute top-0.5 flex h-6 items-center justify-center overflow-hidden',
                                'transition-[filter,box-shadow] duration-150',
                                segment.startsEarlier ? '' : 'rounded-l',
                                segment.continues ? '' : 'rounded-r',
                                isActive ? 'z-10 ring-2 ring-blue-600 ring-offset-1' : '',
                              ].join(' ')}
                              style={{
                                left: `${segment.left}%`,
                                // Hairline floor so a 15-minute inspection stays
                                // visible and clickable on a 24-hour axis.
                                width: `max(${segment.width}%, 6px)`,
                                background: DUTY_STATUS_COLORS[event.duty_status],
                              }}
                            >
                              {segment.width > 7 && (
                                <Icon aria-hidden="true" className="h-3 w-3 text-white/90" />
                              )}
                            </button>
                          );
                        })}
                    </div>
                  ))}
                </div>

                {/* Hour axis */}
                <div className="relative mt-1 h-4" aria-hidden="true">
                  {TICKS.map((tick, index) => (
                    <span
                      key={tick}
                      className="absolute text-[10px] tabular-nums text-slate-400"
                      style={{
                        left: `${tick}%`,
                        transform:
                          index === 0
                            ? 'translateX(0)'
                            : index === TICKS.length - 1
                              ? 'translateX(-100%)'
                              : 'translateX(-50%)',
                      }}
                    >
                      {TICK_LABELS[index]}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ))}

        {/* Legend */}
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-gray-100 pt-3 text-xs text-slate-600">
          {LANES.map((lane) => (
            <li key={lane} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                data-print-color
                className="h-2.5 w-4 rounded-sm"
                style={{ background: DUTY_STATUS_COLORS[lane] }}
              />
              {dutyStatusLabel(lane)}
            </li>
          ))}
        </ul>

        <p className="text-xs leading-relaxed text-slate-500">
          Each bar is one timeline event. Hover or focus a bar to highlight it; select one to
          highlight the matching row in the timeline. Events crossing midnight are drawn on both
          days.
        </p>
      </div>
    </Card>
  );
}
