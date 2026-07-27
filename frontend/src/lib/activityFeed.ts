/**
 * Operations activity feed — what the planner did, across all trips.
 *
 * Distinct from the HOS timeline: that describes a driver's duty periods, this
 * describes planning operations (a trip was created, a route came back, planning
 * finished or was rejected).
 *
 * Every event is derived from fields the API already returns. The Trip row
 * carries exactly two timestamps, `created_at` and `updated_at`, so:
 *
 *  - **Trip created** is stamped `created_at` — exact.
 *  - **Route generated** is inferred from `total_distance_miles` being set,
 *    because `RoutingService` is what persists that value. Stamped `updated_at`.
 *  - **Planning completed / failed** comes from `status`. Also stamped
 *    `updated_at`.
 *
 * The last two therefore share a timestamp: routing and planning happen inside
 * one request and the API exposes no per-stage times. They are ordered
 * logically rather than by clock, which the sort below preserves.
 *
 * **"Replanned" is deliberately absent.** Detecting a re-plan needs either a
 * revision counter or a plan-history record, and the API has neither — two
 * timestamps cannot distinguish "planned once, slowly" from "planned twice".
 * Inventing it would mean guessing, so it is omitted rather than faked.
 */
import type { Trip } from '../types/api';

export type ActivityKind = 'created' | 'route' | 'completed' | 'failed';

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  at: string;
  tripId: string;
  title: string;
  detail: string;
  /** Where the event's timestamp is exact, versus inferred from `updated_at`. */
  exact: boolean;
}

/** Rank within a shared timestamp, so a route never sorts after its outcome. */
const STAGE_RANK: Record<ActivityKind, number> = {
  created: 0,
  route: 1,
  completed: 2,
  failed: 2,
};

function routeLabel(trip: Trip): string {
  return `${trip.current_location_text} → ${trip.pickup_location_text} → ${trip.dropoff_location_text}`;
}

export function buildActivityFeed(trips: Trip[], limit = 12): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const trip of trips) {
    events.push({
      id: `${trip.id}:created`,
      kind: 'created',
      at: trip.created_at,
      tripId: trip.id,
      title: 'Trip created',
      detail: routeLabel(trip),
      exact: true,
    });

    const routed = trip.total_distance_miles !== null;
    const attempted = routed || trip.status !== 'pending';

    if (routed) {
      events.push({
        id: `${trip.id}:route`,
        kind: 'route',
        at: trip.updated_at,
        tripId: trip.id,
        title: 'Route generated',
        detail: `${trip.total_distance_miles} mi · ${trip.dropoff_location_text}`,
        exact: false,
      });
    }

    if (trip.status === 'planned') {
      events.push({
        id: `${trip.id}:completed`,
        kind: 'completed',
        at: trip.updated_at,
        tripId: trip.id,
        title: 'Planning completed',
        detail: `Legal schedule produced for ${trip.dropoff_location_text}`,
        exact: false,
      });
    } else if (trip.status === 'failed') {
      events.push({
        id: `${trip.id}:failed`,
        kind: 'failed',
        at: trip.updated_at,
        tripId: trip.id,
        // The blocking rule is only on the failing response, not on the Trip
        // row, so a historical failure cannot name its rule here.
        detail: 'No schedule within the hours-of-service limits',
        title: 'Planning failed',
        exact: false,
      });
    } else if (!attempted) {
      // Created but never routed: nothing more to report than the creation.
      continue;
    }
  }

  return events
    .sort((a, b) => {
      const byTime = new Date(b.at).getTime() - new Date(a.at).getTime();
      if (byTime !== 0) return byTime;
      // Same instant: newest stage first, so the outcome reads above its route.
      return STAGE_RANK[b.kind] - STAGE_RANK[a.kind];
    })
    .slice(0, limit);
}
