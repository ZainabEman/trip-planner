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

/** Whether a trip has a compliant, stored plan. */
export function isLegal(status: TripStatus): boolean {
  return status === 'planned';
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

/**
 * Driving hours for a trip, from the route's own duration.
 *
 * `Trip.total_duration_minutes` is what the routing provider reported for the
 * two legs, i.e. time behind the wheel. This is *not* the trip's elapsed
 * duration — that adds inspections, loading and rest, and is only derivable
 * once a timeline exists (see `elapsedHours`).
 */
export function drivingHours(trip: Trip): number | null {
  if (trip.total_duration_minutes === null) return null;
  return trip.total_duration_minutes / 60;
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

/** Free-text match across the fields a dispatcher would search by. */
export function matchesQuery(trip: Trip, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    trip.id,
    trip.current_location_text,
    trip.pickup_location_text,
    trip.dropoff_location_text,
  ].some((field) => field.toLowerCase().includes(q));
}
