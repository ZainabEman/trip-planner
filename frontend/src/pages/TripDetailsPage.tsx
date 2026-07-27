/**
 * A single trip, loaded from stored data.
 *
 * Composed entirely from the components the planner uses — TripStatusBar,
 * SummaryCard, TimelineList, RoutePanel, TripMetaGrid — so a trip looks the same
 * whether you have just planned it or opened it a week later.
 *
 * The one wrinkle: `GET /trips/{id}/` returns no `summary` block (the API
 * computes that per planning run and stores no columns for it), so the summary
 * is reconstructed from the persisted trip + timeline by
 * `tripMetrics.summaryFromStored`. That keeps SummaryCard reusable unchanged.
 */
import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { hrefFor } from '../hooks/useHashRoute';
import { ApiError, api } from '../lib/apiClient';
import { summaryFromStored } from '../lib/tripMetrics';
import type { RouteLeg, TimelineEvent, Trip } from '../types/api';
import { RoutePanel } from '../components/RoutePanel';
import { SummaryCard } from '../components/SummaryCard';
import { TimelineList } from '../components/TimelineList';
import { TripMetaGrid } from '../components/TripMetaGrid';
import { TripStatusBar } from '../components/TripStatusBar';
import { SummarySkeleton, TimelineSkeleton } from '../components/Skeletons';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';

interface Loaded {
  trip: Trip;
  timeline: TimelineEvent[];
  route: RouteLeg[];
}

export function TripDetailsPage({ tripId }: { tripId: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // The three read endpoints are independent; fetch them together.
        const [trip, timeline, route] = await Promise.all([
          api.getTrip(tripId),
          api.getTimeline(tripId),
          api.getRoute(tripId),
        ]);
        if (!cancelled) {
          setData({ trip, timeline, route });
          setLoading(false);
        }
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof ApiError ? cause : new ApiError(0, 'Could not load this trip.'));
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [tripId, token]);

  const backLink = (
    <a
      href={hrefFor('history')}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-blue-700 hover:text-blue-800"
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      Back to history
    </a>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {backLink}
        {/* Shape-matched placeholders, so the page does not jump when data lands. */}
        <SummarySkeleton />
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <TimelineSkeleton />
          <Card title="Route">
            <Skeleton className="h-[320px] w-full sm:h-[420px]" />
          </Card>
        </div>
      </div>
    );
  }

  if (error || !data) {
    const notFound = error?.statusCode === 404;
    return (
      <div className="space-y-6">
        {backLink}
        <Card ariaLabel="Trip not available">
          <EmptyState
            illustration="route"
            title={notFound ? 'Trip not found' : 'Could not load this trip'}
            description={
              notFound
                ? 'This trip no longer exists. It may have been deleted.'
                : error?.statusCode === 0
                  ? 'The planner could not reach the server. Check that the backend is running.'
                  : (error?.message ?? 'Something went wrong.')
            }
            action={
              notFound ? undefined : (
                <Button variant="secondary" onClick={() => setToken((n) => n + 1)}>
                  <RefreshCw aria-hidden="true" className="h-4 w-4" />
                  Try again
                </Button>
              )
            }
          />
        </Card>
      </div>
    );
  }

  const { trip, timeline, route } = data;
  const planned = trip.status === 'planned' && timeline.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {backLink}
        <a href={hrefFor('planner')} className="shrink-0">
          <Button variant="secondary">Plan a new trip</Button>
        </a>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {trip.current_location_text} → {trip.pickup_location_text} → {trip.dropoff_location_text}
        </h1>
        <p className="mt-1 font-mono text-xs text-slate-500">{trip.id}</p>
      </div>

      {/* Legal status */}
      {planned ? (
        <TripStatusBar
          kind="legal"
          plan={{
            planning_status: trip.status,
            trip,
            route,
            timeline,
            summary: summaryFromStored(trip, timeline),
          }}
        />
      ) : (
        <TripStatusBar
          kind="illegal"
          reason={
            trip.status === 'failed'
              ? 'Planning could not produce a schedule within the hours-of-service limits.'
              : 'This trip has not been planned yet, so it has no schedule.'
          }
        />
      )}

      {/* Metrics */}
      {planned && (
        <SummaryCard summary={summaryFromStored(trip, timeline)} planningStatus={trip.status} />
      )}

      {/* Timeline beside the map */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <TimelineList events={timeline} />
        <RoutePanel route={route} timeline={timeline} />
      </div>

      {/* Metadata */}
      <TripMetaGrid trip={trip} timeline={timeline} route={route} />
    </div>
  );
}
