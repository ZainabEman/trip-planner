/**
 * Operations dashboard.
 *
 * Answers four questions before the dispatcher reads anything: how many trips,
 * how many planned, how many failed, how many still pending. Then fleet averages,
 * then what the planner has been doing.
 *
 * Every figure is computed client-side from the existing endpoints — see
 * `lib/tripStats.ts` and `lib/activityFeed.ts`. Each KPI links into the history
 * page pre-filtered, so a non-zero failure count is one click from the trips
 * behind it.
 */
import { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Gauge,
  ListChecks,
  Percent,
  Plus,
  Route as RouteIcon,
  Timer,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { hrefFor } from '../hooks/useHashRoute';
import { useTrips } from '../hooks/useTrips';
import { buildActivityFeed } from '../lib/activityFeed';
import { formatDecimal, formatDuration } from '../lib/format';
import { computeAnalytics, computeKpis } from '../lib/tripStats';
import { DashboardSkeleton } from '../components/Skeletons';
import { KpiCard } from '../components/KpiCard';
import { OperationsActivityFeed } from '../components/OperationsActivityFeed';
import { TripCard } from '../components/TripCard';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { StatTile } from '../components/ui/StatTile';

const RECENT_COUNT = 4;
const ACTIVITY_COUNT = 10;
const ICON = 'h-4 w-4';
const TILE_ICON = 'h-3.5 w-3.5';

export function DashboardPage() {
  const { rows, loading, error } = useTrips({ enrich: true });

  const trips = useMemo(() => rows.map((row) => row.trip), [rows]);
  const kpis = useMemo(() => computeKpis(trips), [trips]);
  const analytics = useMemo(() => computeAnalytics(rows), [rows]);
  const activity = useMemo(() => buildActivityFeed(trips, ACTIVITY_COUNT), [trips]);
  const recent = rows.slice(0, RECENT_COUNT);

  return (
    <div className="space-y-6">
      {/* Primary action */}
      <section
        aria-label="Start planning"
        className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="max-w-xl">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Dispatch operations
            </h1>
            <p className="mt-2 text-base leading-relaxed text-slate-600">
              Plan a compliant trip in one step: three locations and the hours already used in the
              driver&apos;s 70-hour cycle produce a route, a legal schedule, and a projected
              arrival.
            </p>
          </div>
          <a href={hrefFor('planner')} className="shrink-0">
            <Button size="lg">
              <Plus aria-hidden="true" className={ICON} />
              Start planning
            </Button>
          </a>
        </div>
      </section>

      {loading && <DashboardSkeleton />}

      {!loading && error && (
        <Card ariaLabel="Dashboard unavailable">
          <EmptyState
            illustration="trips"
            title="Could not load operations data"
            description={
              error.statusCode === 0
                ? 'The planner could not reach the server. Check that the backend is running, then reload.'
                : error.message
            }
            action={
              <a href={hrefFor('planner')}>
                <Button variant="secondary">Go to planner</Button>
              </a>
            }
          />
        </Card>
      )}

      {!loading && !error && kpis.total === 0 && (
        <Card ariaLabel="No trips">
          <EmptyState
            illustration="trips"
            title="No trips yet"
            description="Plan your first trip and this dashboard will fill with fleet counts, averages and planning activity."
            action={
              <a href={hrefFor('planner')}>
                <Button>
                  <Plus aria-hidden="true" className={ICON} />
                  Plan your first trip
                </Button>
              </a>
            }
          />
        </Card>
      )}

      {!loading && !error && kpis.total > 0 && (
        <>
          {/* KPIs */}
          <section aria-label="Fleet counts">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <KpiCard
                label="Total trips"
                value={kpis.total}
                icon={<ListChecks className={ICON} />}
                hint="View history"
                href={hrefFor('history')}
              />
              <KpiCard
                label="Planned"
                value={kpis.planned}
                tone="success"
                icon={<CheckCircle2 className={ICON} />}
                hint="Legal schedules"
                href={hrefFor('history')}
              />
              <KpiCard
                label="Failed"
                value={kpis.failed}
                tone={kpis.failed > 0 ? 'danger' : 'neutral'}
                icon={<AlertTriangle className={ICON} />}
                hint={kpis.failed > 0 ? 'Needs attention' : 'None'}
                href={hrefFor('history')}
              />
              <KpiCard
                label="Pending"
                value={kpis.pending}
                tone={kpis.pending > 0 ? 'warning' : 'neutral'}
                icon={<Clock className={ICON} />}
                hint={kpis.pending > 0 ? 'Not yet planned' : 'None'}
                href={hrefFor('history')}
              />
              <KpiCard
                label="Success rate"
                value={kpis.successRate}
                unit="%"
                tone="brand"
                icon={<Percent className={ICON} />}
                hint={`${kpis.planned} of ${kpis.total} trips`}
              />
            </div>
          </section>

          {/* Analytics */}
          <Card
            title="Fleet analytics"
            description={
              analytics.routedCount < kpis.total
                ? `Averages over the ${analytics.routedCount} trip${analytics.routedCount === 1 ? '' : 's'} with a computed route`
                : 'Averages across all trips'
            }
          >
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatTile
                label="Avg distance"
                value={
                  analytics.avgDistanceMiles === null
                    ? '—'
                    : formatDecimal(analytics.avgDistanceMiles.toFixed(1))
                }
                unit="mi"
                icon={<Gauge className={TILE_ICON} />}
                emphasis
              />
              <StatTile
                label="Avg driving"
                value={
                  analytics.avgDrivingHours === null
                    ? '—'
                    : formatDuration(analytics.avgDrivingHours * 60)
                }
                icon={<Clock className={TILE_ICON} />}
                emphasis
              />
              <StatTile
                label="Avg total duration"
                value={
                  analytics.avgTotalDurationHours === null
                    ? '—'
                    : formatDuration(analytics.avgTotalDurationHours * 60)
                }
                icon={<Timer className={TILE_ICON} />}
              />
              <StatTile
                label="Longest trip"
                value={
                  analytics.longest === null ? '—' : formatDecimal(String(analytics.longest.miles))
                }
                unit="mi"
                icon={<TrendingUp className={TILE_ICON} />}
              />
              <StatTile
                label="Shortest trip"
                value={
                  analytics.shortest === null
                    ? '—'
                    : formatDecimal(String(analytics.shortest.miles))
                }
                unit="mi"
                icon={<TrendingDown className={TILE_ICON} />}
              />
            </dl>

            {analytics.durationSampleCount < analytics.routedCount && (
              <p className="mt-4 text-xs leading-relaxed text-slate-500">
                Total duration is averaged over the {analytics.durationSampleCount} trip
                {analytics.durationSampleCount === 1 ? '' : 's'} with a stored schedule — it needs
                an arrival time, which only planned trips have.
              </p>
            )}
            {(analytics.longest || analytics.shortest) && (
              <dl className="mt-4 space-y-1 border-t border-gray-100 pt-3 text-xs text-slate-500">
                {analytics.longest && (
                  <div className="flex gap-2">
                    <dt>Longest:</dt>
                    <dd className="truncate text-slate-700">
                      {analytics.longest.trip.current_location_text} →{' '}
                      {analytics.longest.trip.dropoff_location_text}
                    </dd>
                  </div>
                )}
                {analytics.shortest && (
                  <div className="flex gap-2">
                    <dt>Shortest:</dt>
                    <dd className="truncate text-slate-700">
                      {analytics.shortest.trip.current_location_text} →{' '}
                      {analytics.shortest.trip.dropoff_location_text}
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </Card>

          {/* Activity + recent trips */}
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Card
              title="Operations activity"
              description="Planning events, newest first"
              action={
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Activity aria-hidden="true" className="h-3.5 w-3.5" />
                  {activity.length} events
                </span>
              }
            >
              {activity.length > 0 ? (
                <OperationsActivityFeed events={activity} />
              ) : (
                <EmptyState
                  icon={<Activity className="h-5 w-5" />}
                  title="No activity yet"
                  description="Planning events appear here as trips are created and planned."
                  compact
                />
              )}
            </Card>

            <Card
              title="Recent trips"
              description="Most recently created"
              action={
                <a
                  href={hrefFor('history')}
                  className="flex min-h-9 items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-800"
                >
                  View all
                  <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                </a>
              }
            >
              <ul className="space-y-3">
                {recent.map((row) => (
                  <TripCard key={row.trip.id} trip={row.trip} arrival={row.arrival} />
                ))}
              </ul>
            </Card>
          </div>

          {/* Reference links */}
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                key: 'hos' as const,
                title: 'Hours of Service',
                body: 'The five federal limits, in plain terms',
              },
              { key: 'faq' as const, title: 'FAQ', body: 'How planning works and why trips fail' },
              {
                key: 'support' as const,
                title: 'Support',
                body: 'Troubleshooting and how to report an issue',
              },
            ].map((item) => (
              <a
                key={item.key}
                href={hrefFor(item.key)}
                className="group flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-blue-300"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">{item.title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                    {item.body}
                  </span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5"
                />
              </a>
            ))}
          </div>
        </>
      )}

      {!loading && !error && kpis.total === 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { key: 'hos' as const, title: 'Hours of Service', body: 'The five federal limits' },
            { key: 'faq' as const, title: 'FAQ', body: 'How planning works' },
            { key: 'support' as const, title: 'Support', body: 'Troubleshooting' },
          ].map((item) => (
            <a
              key={item.key}
              href={hrefFor(item.key)}
              className="group flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-blue-300"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">{item.title}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{item.body}</span>
              </span>
              <ArrowRight aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            </a>
          ))}
        </div>
      )}

      <p className="px-1 text-xs text-slate-500">
        <RouteIcon aria-hidden="true" className="mr-1 inline h-3 w-3" />
        Counts and averages are computed in the browser from the trips API. Planning projections
        only — not an official record of duty status.
      </p>
    </div>
  );
}
