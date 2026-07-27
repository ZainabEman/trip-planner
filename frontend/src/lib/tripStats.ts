/**
 * Fleet-level aggregates for the dashboard.
 *
 * Everything here is computed on the client from data the existing endpoints
 * already return — `GET /trips/` supplies status, distance and route duration;
 * arrival comes from the timeline pass in `useTrips`. No aggregate endpoint is
 * requested or required.
 *
 * Averages deliberately report their own sample size. A fleet where half the
 * trips never planned would otherwise show an "average distance" silently
 * computed over a subset, which is the kind of number a dispatcher would act on
 * without realising it excluded failures.
 */
import type { Trip } from '../types/api';
import type { TripRow } from '../hooks/useTrips';

export interface TripKpis {
  total: number;
  planned: number;
  failed: number;
  pending: number;
  /** Planned as a share of *all* trips, 0–100. */
  successRate: number;
}

export function computeKpis(trips: Trip[]): TripKpis {
  const planned = trips.filter((trip) => trip.status === 'planned').length;
  const failed = trips.filter((trip) => trip.status === 'failed').length;
  const pending = trips.filter((trip) => trip.status === 'pending').length;
  const total = trips.length;

  return {
    total,
    planned,
    failed,
    pending,
    // Share of every trip, not of "attempted" ones: a routing failure leaves a
    // trip `pending`, so an attempted-only denominator would quietly hide those.
    successRate: total === 0 ? 0 : Math.round((planned / total) * 100),
  };
}

export interface ExtremeTrip {
  trip: Trip;
  miles: number;
}

export interface TripAnalytics {
  /** Trips that had a distance recorded, i.e. the sample the averages use. */
  routedCount: number;
  avgDistanceMiles: number | null;
  avgDrivingHours: number | null;
  /** Sample for total duration is smaller: it needs a stored timeline. */
  durationSampleCount: number;
  avgTotalDurationHours: number | null;
  longest: ExtremeTrip | null;
  shortest: ExtremeTrip | null;
}

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

export function computeAnalytics(rows: TripRow[]): TripAnalytics {
  const withDistance = rows
    .map((row) => ({ trip: row.trip, miles: Number(row.trip.total_distance_miles) }))
    .filter((entry) => Number.isFinite(entry.miles) && entry.miles > 0);

  const drivingHours = rows
    .map((row) => row.trip.total_duration_minutes)
    .filter((minutes): minutes is number => minutes !== null && minutes > 0)
    .map((minutes) => minutes / 60);

  // Total duration = trip start → arrival. Both are already available: the
  // engine's timeline starts exactly at `trip_start_time`, and `arrival` is the
  // end of its last event, so no extra request is needed.
  const durations = rows
    .filter((row) => Boolean(row.arrival))
    .map(
      (row) =>
        (new Date(row.arrival as string).getTime() - new Date(row.trip.trip_start_time).getTime()) /
        3_600_000,
    )
    .filter((hours) => Number.isFinite(hours) && hours > 0);

  const sorted = [...withDistance].sort((a, b) => b.miles - a.miles);

  return {
    routedCount: withDistance.length,
    avgDistanceMiles: mean(withDistance.map((entry) => entry.miles)),
    avgDrivingHours: mean(drivingHours),
    durationSampleCount: durations.length,
    avgTotalDurationHours: mean(durations),
    longest: sorted[0] ?? null,
    shortest: sorted.length > 0 ? sorted[sorted.length - 1] : null,
  };
}
