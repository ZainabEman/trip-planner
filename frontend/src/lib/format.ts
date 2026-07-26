/**
 * Display formatting for API values.
 *
 * All timestamps arrive as ISO-8601 UTC. They are rendered in UTC on purpose:
 * a plan's clocks are computed in UTC by the engine, and silently shifting
 * them to the browser's timezone would make the timeline disagree with the
 * duty-hour arithmetic the summary reports.
 */
import type { DutyStatus, EventType } from '../types/api';

const DUTY_STATUS_LABELS: Record<DutyStatus, string> = {
  off_duty: 'Off Duty',
  sleeper_berth: 'Sleeper Berth',
  driving: 'Driving',
  on_duty_not_driving: 'On Duty (Not Driving)',
};

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  drive: 'Drive',
  pickup: 'Pickup',
  dropoff: 'Dropoff',
  fuel: 'Fuel',
  rest_break_30: 'Rest Break (30-min)',
  daily_rest_10: 'Daily Rest (10-hr)',
  cycle_restart_34: 'Cycle Restart (34-hr)',
  pretrip_inspection: 'Pre-Trip Inspection',
  posttrip_inspection: 'Post-Trip Inspection',
};

export function dutyStatusLabel(status: DutyStatus): string {
  return DUTY_STATUS_LABELS[status] ?? status;
}

export function eventTypeLabel(type: EventType): string {
  return EVENT_TYPE_LABELS[type] ?? type;
}

const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const DATETIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

/** `14:15` */
export function formatTime(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}

/** `Jul 27` */
export function formatDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}

/** `Jul 27, 2026, 08:00` */
export function formatDateTime(iso: string): string {
  return DATETIME_FORMAT.format(new Date(iso));
}

/** `2h 30m`, `45m`, `34h` */
export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/** Elapsed minutes between two ISO timestamps. */
export function durationMinutes(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
}

/**
 * Render a decimal-string field for display, e.g. `"935.00"` → `935`.
 *
 * Returns an em dash for null so an unpopulated metric reads as absent rather
 * than as zero.
 */
export function formatDecimal(value: string | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined || value === '') return '—';
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return '—';
  return parsed.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
}

/** Whether two ISO timestamps fall on different UTC calendar days. */
export function crossesDateBoundary(previousIso: string, currentIso: string): boolean {
  return formatDate(previousIso) !== formatDate(currentIso);
}
