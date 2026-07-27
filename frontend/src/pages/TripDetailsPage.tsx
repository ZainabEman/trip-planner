/**
 * A single trip, as a dispatch report.
 *
 * Six sections in reading order: status, summary, route, timeline, trip
 * information, planner activity. Everything is composed from the components the
 * planner uses, so a trip looks the same whether you just planned it or opened
 * it a week later.
 *
 * Two wrinkles, both from the API shape rather than choice:
 *  - `GET /trips/{id}/` returns no `summary` block, so it is reconstructed from
 *    the persisted trip + timeline by `tripMetrics.summaryFromStored`;
 *  - planner activity for a stored trip is inferred by
 *    `planSteps.stepsFromStoredTrip`, since the live phase is long gone.
 *
 * The page is print-ready: chrome carries `no-print`, and a print-only header
 * supplies the title a printed report needs once the nav is gone.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { hrefFor } from '../hooks/useHashRoute';
import { ApiError, api } from '../lib/apiClient';
import { APP_CONTEXT, APP_NAME, REGULATION } from '../lib/appInfo';
import { formatDateTime } from '../lib/format';
import { stepsFromStoredTrip } from '../lib/planSteps';
import { summaryFromStored } from '../lib/tripMetrics';
import type { RouteLeg, TimelineEvent, Trip } from '../types/api';
import { PlanningActivityLog } from '../components/PlanningActivityLog';
import { DutyStatusGraph } from '../components/DutyStatusGraph';
import { RoutePanel } from '../components/RoutePanel';
import { SummaryCard } from '../components/SummaryCard';
import { SummarySkeleton, TimelineSkeleton } from '../components/Skeletons';
import { TimelineList } from '../components/TimelineList';
import { TripActions } from '../components/TripActions';
import { TripInformationCard } from '../components/TripInformationCard';
import { TripStatusBar } from '../components/TripStatusBar';
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
  const [reloadToken, setReloadToken] = useState(0);
  /** Event highlighted in both the graph and the timeline list. */
  const [selected, setSelected] = useState<number | null>(null);

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
  }, [tripId, reloadToken]);

  const activitySteps = useMemo(
    () => (data ? stepsFromStoredTrip(data.trip, data.timeline.length, data.route.length) : []),
    [data],
  );

  const backLink = (
    <a
      href={hrefFor('history')}
      className="no-print inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-blue-700 hover:text-blue-800"
    >
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      Back to history
    </a>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {backLink}
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
              notFound ? (
                <a href={hrefFor('history')}>
                  <Button variant="secondary">Back to history</Button>
                </a>
              ) : (
                <Button variant="secondary" onClick={() => setReloadToken((n) => n + 1)}>
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
  const summary = summaryFromStored(trip, timeline);

  return (
    <div className="space-y-6">
      {/* Screen-only chrome */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        {backLink}
        <a href={hrefFor('planner')}>
          <Button variant="secondary">Plan a new trip</Button>
        </a>
      </div>

      {/* Print-only masthead — replaces the hidden nav on paper. */}
      <div className="print-only mb-4 border-b border-gray-300 pb-3">
        <p className="text-base font-semibold">
          {APP_NAME} — {APP_CONTEXT}
        </p>
        <p className="mt-0.5 text-xs">
          Trip report · generated {formatDateTime(new Date().toISOString())} · projections based on{' '}
          {REGULATION}. Not an official record of duty status.
        </p>
      </div>

      {/* Report heading */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {trip.current_location_text} → {trip.pickup_location_text} →{' '}
            {trip.dropoff_location_text}
          </h1>
          <p className="mt-1 font-mono text-xs text-slate-500">{trip.id}</p>
        </div>
        <TripActions trip={trip} timeline={timeline} route={route} />
      </header>

      {/* 1 — Trip status */}
      {planned ? (
        <TripStatusBar
          kind="legal"
          plan={{ planning_status: trip.status, trip, route, timeline, summary }}
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

      {/* 2 — Trip summary */}
      {planned && <SummaryCard summary={summary} planningStatus={trip.status} />}

      {/* 3 — Duty status graph, the dispatcher's log view */}
      <DutyStatusGraph
        events={timeline}
        selectedSequence={selected}
        onSelect={(event) => setSelected(event ? event.sequence : null)}
      />

      {/* 4 & 5 — Route beside the timeline on desktop */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <TimelineList events={timeline} selectedSequence={selected} onSelect={setSelected} />
        <RoutePanel route={route} timeline={timeline} />
      </div>

      {/* 5 — Trip information */}
      <TripInformationCard trip={trip} timeline={timeline} route={route} />

      {/* 6 — Planner activity */}
      <PlanningActivityLog steps={activitySteps} />
    </div>
  );
}
