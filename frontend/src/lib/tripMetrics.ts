/**
 * Derivations shared by every view that shows a trip.
 *
 * The planner, the history cards and the details page all need the same handful
 * of answers — is it legal, when does it arrive, how far, how long driving —
 * and each of those is computed from the API payload rather than served by it.
 * Before this module the planner derived arrival inline and history would have
 * had to repeat it; putting them here is what stops the three views drifting.
 *
 * Nothing here fetches or formats: it returns raw values and lets
 * `lib/format.ts` render them.
 */
import type { TimelineEvent, Trip, TripStatus } from '../types/api';

/**
 * Projected arrival = the end of the last timeline event.
 *
 * The engine guarantees the timeline spans trip start to delivery completion
 * exactly, so the final event's `end_time` *is* the arrival. Returns null when
 * no timeline is stored (an unplanned or failed trip).
 */
export function arrivalTime(timeline: TimelineEvent[]): string | null {
  if (timeline.length === 0) return null;
  return timeline[timeline.length - 1].end_time;
}

/**
 * Legality label for a badge.
 *
 * `pending` deliberately reads as "Not planned" rather than "Not legal": no
 * rule was violated, the trip simply has not been through the engine yet — and
 * a routing failure also leaves a trip pending, so calling it illegal would
 * misattribute the cause.
 */
export function legalityLabel(status: TripStatus): string {
  switch (status) {
    case 'planned':
      return 'Legal';
    case 'failed':
      return 'Not legal';
    case 'pending':
    default:
      return 'Not planned';
  }
}

/** Wall-clock span of a stored timeline, in hours. */
export function elapsedHours(timeline: TimelineEvent[]): number | null {
  if (timeline.length === 0) return null;
  const start = new Date(timeline[0].start_time).getTime();
  const end = new Date(timeline[timeline.length - 1].end_time).getTime();
  return (end - start) / 3_600_000;
}

/** Sum the durations of every event with the given duty status, in hours. */
export function hoursByDutyStatus(
  timeline: TimelineEvent[],
  status: TimelineEvent['duty_status'],
): number {
  return timeline
    .filter((event) => event.duty_status === status)
    .reduce(
      (total, event) =>
        total +
        (new Date(event.end_time).getTime() - new Date(event.start_time).getTime()) / 3_600_000,
      0,
    );
}

/**
 * Rebuild the summary shape that `SummaryCard` renders, from stored data.
 *
 * `POST /plan/` returns a `summary` block, but `GET /trips/{id}/` does not —
 * the API computes it per planning run and stores no columns for it. The trip
 * details page therefore reconstructs it from the persisted trip + timeline so
 * it can reuse `SummaryCard` unchanged rather than a near-duplicate component.
 * Decimal fields are emitted as strings to match the wire format the card
 * already expects.
 */
export function summaryFromStored(trip: Trip, timeline: TimelineEvent[]) {
  const elapsed = elapsedHours(timeline);
  return {
    event_count: timeline.length,
    driving_hours: hoursByDutyStatus(timeline, 'driving').toFixed(2),
    on_duty_hours: hoursByDutyStatus(timeline, 'on_duty_not_driving').toFixed(2),
    off_duty_hours: (
      hoursByDutyStatus(timeline, 'off_duty') + hoursByDutyStatus(timeline, 'sleeper_berth')
    ).toFixed(2),
    total_elapsed_hours: (elapsed ?? 0).toFixed(2),
    total_distance_miles: trip.total_distance_miles,
    total_duration_minutes: trip.total_duration_minutes,
  };
}

/**
 * Free-text match across the fields a dispatcher would search by.
 *
 * Includes the status and its legality wording, so typing "failed" or "legal"
 * narrows the list the same way the filter chips do — searching for what you can
 * see on the card should work.
 *
 * Locations and the trip ID match anywhere in the value, because "worth" should
 * find "Fort Worth". Status fields match only from the *start* of the label:
 * substring matching there made "legal" also match "Not legal" and "planned"
 * match "Not planned", which is the opposite of what was asked for.
 */
export function matchesQuery(trip: Trip, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const substringFields = [
    trip.id,
    trip.current_location_text,
    trip.pickup_location_text,
    trip.dropoff_location_text,
  ];
  if (substringFields.some((field) => field.toLowerCase().includes(q))) return true;

  const prefixFields = [trip.status, legalityLabel(trip.status)];
  return prefixFields.some((field) => field.toLowerCase().startsWith(q));
}

/** Quick date windows offered on the history page. */
export type DateRange = 'today' | '7d' | '30d' | 'all';

const RANGE_DAYS: Record<Exclude<DateRange, 'all' | 'today'>, number> = { '7d': 7, '30d': 30 };

/**
 * Whether a trip was created inside the given window.
 *
 * "Today" is the viewer's local calendar day, not a rolling 24 hours — a
 * dispatcher asking "what did we plan today" means since midnight.
 */
export function withinRange(trip: Trip, range: DateRange, now = new Date()): boolean {
  if (range === 'all') return true;
  const created = new Date(trip.created_at);

  if (range === 'today') {
    return created.toDateString() === now.toDateString();
  }
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range]);
  return created.getTime() >= cutoff.getTime();
}

/** Sort modes offered on the history page. */
export type SortKey = 'newest' | 'oldest' | 'distance' | 'driving' | 'arrival' | 'alphabetical';

/** Rows missing the sorted-on value always sink to the bottom. */
function nullsLast<T>(a: T | null, b: T | null): number | null {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return null;
}

export interface SortableRow {
  trip: Trip;
  arrival?: string | null;
}

export function compareRows(a: SortableRow, b: SortableRow, key: SortKey): number {
  switch (key) {
    case 'oldest':
      return new Date(a.trip.created_at).getTime() - new Date(b.trip.created_at).getTime();

    case 'distance': {
      const av = a.trip.total_distance_miles === null ? null : Number(a.trip.total_distance_miles);
      const bv = b.trip.total_distance_miles === null ? null : Number(b.trip.total_distance_miles);
      return nullsLast(av, bv) ?? (bv as number) - (av as number); // furthest first
    }

    case 'driving': {
      const av = a.trip.total_duration_minutes ?? null;
      const bv = b.trip.total_duration_minutes ?? null;
      return nullsLast(av, bv) ?? (bv as number) - (av as number); // longest first
    }

    case 'arrival': {
      const av = a.arrival ?? null;
      const bv = b.arrival ?? null;
      return (
        nullsLast(av, bv) ?? new Date(av as string).getTime() - new Date(bv as string).getTime() // soonest first
      );
    }

    case 'alphabetical':
      // By delivery, then origin — the pair a dispatcher scans a manifest by.
      return (
        a.trip.dropoff_location_text.localeCompare(b.trip.dropoff_location_text) ||
        a.trip.current_location_text.localeCompare(b.trip.current_location_text)
      );

    case 'newest':
    default:
      return new Date(b.trip.created_at).getTime() - new Date(a.trip.created_at).getTime();
  }
}
