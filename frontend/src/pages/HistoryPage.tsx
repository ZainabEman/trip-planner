/**
 * Trip history — the operations register.
 *
 * Filter split, forced by the existing API (no new endpoints):
 *  - **status** is a server-side filter (`?status=`), so switching it refetches;
 *  - **text, date range and sort** are client-side over the pages already
 *    loaded, because `GET /trips/` offers neither search nor these orderings.
 *
 * The summary row counts the *loaded* set, so it always agrees with the list
 * below it rather than reporting a server total the list does not show.
 */
import { useMemo, useState } from 'react';
import { CheckCircle2, Clock, ListChecks, Plus, TriangleAlert } from 'lucide-react';
import { hrefFor } from '../hooks/useHashRoute';
import { useTrips } from '../hooks/useTrips';
import { compareRows, matchesQuery, withinRange } from '../lib/tripMetrics';
import type { DateRange, SortKey } from '../lib/tripMetrics';
import { computeKpis } from '../lib/tripStats';
import type { TripStatus } from '../types/api';
import { HistorySkeleton } from '../components/Skeletons';
import { TripCard } from '../components/TripCard';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { FilterTabs } from '../components/ui/FilterTabs';
import { PageHeader } from '../components/ui/PageHeader';
import { SearchInput } from '../components/ui/SearchInput';

type StatusFilter = 'all' | TripStatus;

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'planned', label: 'Planned' },
  { value: 'failed', label: 'Failed' },
  { value: 'pending', label: 'Pending' },
];

const RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'distance', label: 'Distance' },
  { value: 'driving', label: 'Driving hours' },
  { value: 'arrival', label: 'Arrival' },
  { value: 'alphabetical', label: 'A–Z' },
];

/** Empty-state copy per status filter, so each dead end explains itself. */
const NO_MATCH_FOR_STATUS: Record<
  Exclude<StatusFilter, 'all'>,
  { illustration: 'planned' | 'failed' | 'timeline'; title: string; description: string }
> = {
  planned: {
    illustration: 'planned',
    title: 'No planned trips',
    description: 'No trip has produced a legal schedule yet. Plan one to see it here.',
  },
  failed: {
    illustration: 'failed',
    title: 'No failed trips',
    description: 'Nothing has been rejected by the hours-of-service rules. That is good news.',
  },
  pending: {
    illustration: 'timeline',
    title: 'No pending trips',
    description: 'Every trip has been through the planner — none are waiting.',
  },
};

export function HistoryPage() {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [range, setRange] = useState<DateRange>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [query, setQuery] = useState('');

  const { rows, total, loading, error } = useTrips({
    status: status === 'all' ? undefined : status,
    enrich: true,
  });

  const counts = useMemo(() => computeKpis(rows.map((row) => row.trip)), [rows]);

  const visible = useMemo(() => {
    const filtered = rows.filter(
      (row) => matchesQuery(row.trip, query) && withinRange(row.trip, range),
    );
    return [...filtered].sort((a, b) => compareRows(a, b, sort));
  }, [rows, query, range, sort]);

  const isFiltered = Boolean(query.trim()) || range !== 'all';
  const clearFilters = () => {
    setQuery('');
    setRange('all');
  };

  const summary = [
    {
      label: 'Total',
      value: counts.total,
      icon: <ListChecks className="h-3.5 w-3.5" />,
      tone: 'text-slate-900',
    },
    {
      label: 'Planned',
      value: counts.planned,
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      tone: 'text-green-700',
    },
    {
      label: 'Failed',
      value: counts.failed,
      icon: <TriangleAlert className="h-3.5 w-3.5" />,
      tone: 'text-red-700',
    },
    {
      label: 'Pending',
      value: counts.pending,
      icon: <Clock className="h-3.5 w-3.5" />,
      tone: 'text-amber-700',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          title="Trip history"
          intro="Every trip you have planned. Open one to see its route, schedule and legal status."
        />
        <a href={hrefFor('planner')} className="shrink-0">
          <Button>
            <Plus aria-hidden="true" className="h-4 w-4" />
            New trip
          </Button>
        </a>
      </div>

      {/* Summary row — counts the loaded set */}
      {!loading && !error && (
        <section aria-label="History summary">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {summary.map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <dt className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <span aria-hidden="true" className="text-slate-400">
                    {item.icon}
                  </span>
                  {item.label}
                </dt>
                <dd className={`mt-1.5 text-2xl font-semibold tabular-nums ${item.tone}`}>
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Controls */}
      <Card ariaLabel="Search and filters">
        <div className="space-y-4">
          <SearchInput
            id="trip-search"
            label="Search trips by ID, location or status"
            placeholder="Search trip ID, origin, pickup, delivery or status…"
            value={query}
            onChange={setQuery}
          />
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <FilterTabs
              legend="Status"
              options={STATUS_OPTIONS}
              value={status}
              onChange={setStatus}
            />
            <FilterTabs
              legend="Date range"
              options={RANGE_OPTIONS}
              value={range}
              onChange={setRange}
            />
            <FilterTabs legend="Sort by" options={SORT_OPTIONS} value={sort} onChange={setSort} />
            {isFiltered && (
              <Button variant="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </Card>

      {loading && <HistorySkeleton />}

      {!loading && error && (
        <Card ariaLabel="History unavailable">
          <EmptyState
            illustration="trips"
            title="Could not load history"
            description={
              error.statusCode === 0
                ? 'The planner could not reach the server. Check that the backend is running, then reload.'
                : error.message
            }
          />
        </Card>
      )}

      {!loading && !error && (
        <>
          <p aria-live="polite" className="px-1 text-sm text-slate-600">
            Showing <strong className="font-semibold text-slate-900">{visible.length}</strong> of{' '}
            {rows.length} loaded
            {status === 'all' && total > rows.length ? ` · ${total} total on server` : ''}
          </p>

          {/* No trips at all for this status */}
          {rows.length === 0 && (
            <Card ariaLabel="No trips">
              {status === 'all' ? (
                <EmptyState
                  illustration="trips"
                  title="No trips yet"
                  description="Once you plan a trip it will appear here with its route, schedule and legal status."
                  action={
                    <a href={hrefFor('planner')}>
                      <Button>
                        <Plus aria-hidden="true" className="h-4 w-4" />
                        Plan a trip
                      </Button>
                    </a>
                  }
                />
              ) : (
                <EmptyState
                  {...NO_MATCH_FOR_STATUS[status]}
                  action={
                    <Button variant="secondary" onClick={() => setStatus('all')}>
                      Show all trips
                    </Button>
                  }
                  secondaryAction={
                    <a href={hrefFor('planner')}>
                      <Button variant="ghost">Plan a trip</Button>
                    </a>
                  }
                />
              )}
            </Card>
          )}

          {/* Trips exist, but filters exclude them all */}
          {rows.length > 0 && visible.length === 0 && (
            <Card ariaLabel="No search results">
              <EmptyState
                illustration="search"
                title="No matching trips"
                description={
                  query.trim()
                    ? `Nothing matches “${query.trim()}” in the selected date range. Try a shorter term or widen the range.`
                    : 'No trip was created in the selected date range. Try a wider range.'
                }
                action={
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            </Card>
          )}

          {visible.length > 0 && (
            <ul className="space-y-3">
              {visible.map((row) => (
                <TripCard key={row.trip.id} trip={row.trip} arrival={row.arrival} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
