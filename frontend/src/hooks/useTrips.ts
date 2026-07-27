/**
 * Loads trips for the history and dashboard views.
 *
 * Two constraints shape this, both from the existing API (no new endpoints):
 *
 * 1. `GET /trips/` supports `status` and `ordering` but **no text search**, so
 *    free-text filtering happens on the client. To make that useful the hook
 *    walks the paginated endpoint up to `MAX_PAGES`, rather than searching only
 *    whatever page you happen to be on.
 *
 * 2. Arrival time is not on the Trip row — it is the end of the last timeline
 *    event. Filling it means one `GET /trips/{id}/timeline/` per trip, so it is
 *    an opt-in second pass (`enrich`) that runs after the list renders and
 *    degrades to "—" if it fails. Distance and driving hours need no second
 *    call; they come from `total_distance_miles` / `total_duration_minutes`.
 *
 *    That pass keeps the whole timeline, not just the arrival it was originally
 *    added for. The request is already being made, and the timeline is what a
 *    history card needs to show how many days the plan spans and how many rests
 *    the planner inserted — fetching it twice to answer two questions about the
 *    same data would be the odd choice.
 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/apiClient';
import type { TimelineEvent, Trip, TripStatus } from '../types/api';

/** Cap on pages walked, so a large history cannot fan out unbounded. */
const MAX_PAGES = 10;

export interface TripRow {
  trip: Trip;
  /** End of the last timeline event; undefined until enrichment resolves. */
  arrival?: string | null;
  /** The stored timeline; undefined until enrichment resolves, [] if it failed. */
  timeline?: TimelineEvent[];
}

interface UseTripsOptions {
  status?: TripStatus;
  /** Fetch arrival times in a second pass. */
  enrich?: boolean;
  /** Stop after this many trips (the dashboard only wants a handful). */
  limit?: number;
}

export function useTrips({ status, enrich = false, limit }: UseTripsOptions = {}) {
  const [rows, setRows] = useState<TripRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  /**
   * Drop a trip from the list without waiting for a refetch.
   *
   * The delete flow calls this the moment the server confirms, so the row and
   * the counts derived from it disappear together and immediately. A refetch
   * still follows to reconcile with the server, but the UI does not sit on a
   * stale row while that round-trip happens.
   *
   * `total` is decremented alongside, or the "N total on server" line would
   * disagree with the list for as long as the refetch takes.
   */
  const removeLocally = useCallback((tripId: string) => {
    setRows((current) => current.filter((row) => row.trip.id !== tripId));
    setTotal((current) => Math.max(current - 1, 0));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const collected: Trip[] = [];
        let count = 0;

        for (let page = 1; page <= MAX_PAGES; page += 1) {
          const data = await api.listTrips({ status, page, ordering: '-created_at' });
          count = data.count;
          collected.push(...data.results);
          if (!data.next) break;
          if (limit && collected.length >= limit) break;
        }
        if (cancelled) return;

        const trimmed = limit ? collected.slice(0, limit) : collected;
        setRows(trimmed.map((trip) => ({ trip })));
        setTotal(count);
        setLoading(false);

        if (!enrich) return;

        // Second pass: timelines, for arrival and plan composition. Failures
        // per trip are swallowed so one bad row cannot blank the whole list.
        const timelines = await Promise.all(
          trimmed.map(async (trip): Promise<TimelineEvent[]> => {
            if (trip.status !== 'planned') return [];
            try {
              return await api.getTimeline(trip.id);
            } catch {
              return [];
            }
          }),
        );
        if (cancelled) return;
        setRows(
          trimmed.map((trip, index) => ({
            trip,
            timeline: timelines[index],
            arrival:
              timelines[index].length > 0
                ? timelines[index][timelines[index].length - 1].end_time
                : null,
          })),
        );
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof ApiError ? cause : new ApiError(0, 'Could not load trips.'));
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [status, enrich, limit, reloadToken]);

  return { rows, total, loading, error, reload, removeLocally };
}
