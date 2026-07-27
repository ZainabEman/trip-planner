/**
 * Client-side trip export.
 *
 * Generated in the browser from data already fetched — no export endpoint is
 * requested or needed. JSON carries the whole record for re-import or
 * debugging; CSV carries the timeline, because that is the part with rows and
 * the part a dispatcher pastes into a spreadsheet.
 */
import type { RouteLeg, TimelineEvent, Trip } from '../types/api';
import { durationMinutes } from './format';
import { analysePlan, groupIntoDays } from './planAnalysis';
import { arrivalTime, summaryFromStored } from './tripMetrics';

export interface ExportInput {
  trip: Trip;
  timeline: TimelineEvent[];
  route: RouteLeg[];
}

/** Filename stem: short trip id + delivery, so downloads are distinguishable. */
function fileStem(trip: Trip): string {
  const slug = trip.dropoff_location_text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `trip-${trip.id.slice(0, 8)}-${slug || 'export'}`;
}

export function buildTripJson({ trip, timeline, route }: ExportInput): string {
  return JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      // Named so a consumer knows these are projections, not duty records.
      source: 'Truck Trip Planner — planning projection, not an ELD record',
      trip,
      summary: summaryFromStored(trip, timeline),
      // What the planner had to insert, and how the schedule breaks down by
      // day. Derived rather than stored, but exporting it means a consumer of
      // the file does not have to re-derive it — which is the whole point of an
      // export.
      composition: analysePlan(timeline),
      days: groupIntoDays(timeline).map((day) => ({
        day_number: day.dayNumber,
        date: day.label,
        event_count: day.events.length,
        driving_minutes: Math.round(day.drivingMinutes),
        on_duty_minutes: Math.round(day.onDutyMinutes),
        off_duty_minutes: Math.round(day.offDutyMinutes),
        distance_miles: Number(day.distanceMiles.toFixed(2)),
      })),
      projected_arrival: arrivalTime(timeline),
      route,
      timeline,
    },
    null,
    2,
  );
}

/** RFC 4180 quoting: wrap in quotes and double any embedded quote. */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const TIMELINE_COLUMNS = [
  'sequence',
  'planning_day',
  'start_time',
  'end_time',
  'duration_minutes',
  'duty_status',
  'event_type',
  'location_name',
  'latitude',
  'longitude',
  'distance_miles',
  'reason',
] as const;

export function buildTimelineCsv({ trip, timeline }: ExportInput): string {
  const lines: string[] = [];
  const composition = analysePlan(timeline);

  // Which planning day each event belongs to, so the spreadsheet can pivot by
  // day without re-deriving the grouping from timestamps.
  const dayOf = new Map<number, number>();
  for (const day of groupIntoDays(timeline)) {
    for (const event of day.events) dayOf.set(event.sequence, day.dayNumber);
  }

  // A short provenance block above the table. Spreadsheets tolerate it, and
  // without it an exported file has no way to say which trip it came from.
  lines.push(`# Trip,${csvCell(trip.id)}`);
  lines.push(
    `# Route,${csvCell(`${trip.current_location_text} > ${trip.pickup_location_text} > ${trip.dropoff_location_text}`)}`,
  );
  lines.push(`# Status,${csvCell(trip.status)}`);
  lines.push(`# Planning days,${csvCell(composition.days)}`);
  lines.push(
    `# Inserted,${csvCell(`${composition.breaks} break(s), ${composition.resets} reset(s), ${composition.restarts} restart(s), ${composition.fuelStops} fuel stop(s)`)}`,
  );
  lines.push(`# Exported,${csvCell(new Date().toISOString())}`);
  lines.push('');

  lines.push(TIMELINE_COLUMNS.join(','));
  for (const event of timeline) {
    lines.push(
      [
        event.sequence,
        dayOf.get(event.sequence) ?? '',
        event.start_time,
        event.end_time,
        Math.round(durationMinutes(event.start_time, event.end_time)),
        event.duty_status,
        event.event_type,
        event.location_name,
        event.latitude,
        event.longitude,
        event.distance_miles ?? '',
        event.reason,
      ]
        .map(csvCell)
        .join(','),
    );
  }

  // Trailing newline: some tools drop the final row without one.
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Trigger a download of in-memory text.
 *
 * Uses an object URL rather than a data URI so large timelines are not capped
 * by URL length limits, and revokes it once the click has been dispatched.
 */
export function downloadText(filename: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function exportTripJson(input: ExportInput): void {
  downloadText(`${fileStem(input.trip)}.json`, 'application/json', buildTripJson(input));
}

export function exportTimelineCsv(input: ExportInput): void {
  downloadText(`${fileStem(input.trip)}-timeline.csv`, 'text/csv', buildTimelineCsv(input));
}
