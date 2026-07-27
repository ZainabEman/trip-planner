/**
 * Trip history, with search and filters.
 *
 * Filter split, forced by the existing API (no new endpoints):
 *  - **status** is a server-side filter (`?status=`), so switching it refetches;
 *  - **text and date** are client-side over the pages already loaded, because
 *    `GET /trips/` has no search parameter.
 *
 * Ordering is newest-first server-side (`?ordering=-created_at`), with a
 * client-side oldest-first toggle over the same loaded set.
 */
import { useMemo, useState } from 'react';
import { History as HistoryIcon, Plus, SearchX } from 'lucide-react';
import { hrefFor } from '../hooks/useHashRoute';
import { useTrips } from '../hooks/useTrips';
import { matchesQuery } from '../lib/tripMetrics';
import type { TripStatus } from '../types/api';
import { TripCard } from '../components/TripCard';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { FilterTabs } from '../components/ui/FilterTabs';
import { PageHeader } from '../components/ui/PageHeader';
import { SearchInput } from '../components/ui/SearchInput';
import { Spinner } from '../components/ui/Spinner';

type StatusFilter = 'all' | TripStatus;
type SortOrder = 'newest' | 'oldest';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'planned', label: 'Planned' },
  { value: 'failed', label: 'Failed' },
  { value: 'pending', label: 'Pending' },
];

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];

export function HistoryPage() {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');

  const { rows, total, loading, error } = useTrips({
    status: status === 'all' ? undefined : status,
    enrich: true,
  });

  const visible = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (!matchesQuery(row.trip, query)) return false;
      if (fromDate && row.trip.created_at.slice(0, 10) < fromDate) return false;
      return true;
    });
    // The server already returned newest-first; only "oldest" needs reversing.
    return sort === 'oldest' ? [...filtered].reverse() : filtered;
  }, [rows, query, fromDate, sort]);

  const isFiltered = Boolean(query.trim() || fromDate);

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

      {/* Controls */}
      <Card ariaLabel="Search and filters">
        <div className="space-y-4">
          <SearchInput
            id="trip-search"
            label="Search trips by ID, origin, pickup or delivery"
            placeholder="Search by trip ID, origin, pickup or delivery…"
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
              legend="Sort order"
              options={SORT_OPTIONS}
              value={sort}
              onChange={setSort}
            />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="from-date" className="text-xs font-medium text-slate-600">
                Created on or after
              </label>
              <input
                id="from-date"
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="min-h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-slate-900 hover:border-slate-300"
              />
            </div>
            {isFiltered && (
              <Button
                variant="ghost"
                onClick={() => {
                  setQuery('');
                  setFromDate('');
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Results */}
      {loading && (
        <Card ariaLabel="Loading trips">
          <div className="flex items-center justify-center gap-3 py-12 text-slate-500">
            <span className="text-blue-600">
              <Spinner label="Loading trips" />
            </span>
            <span className="text-sm">Loading trips…</span>
          </div>
        </Card>
      )}

      {!loading && error && (
        <Card ariaLabel="Error">
          <EmptyState
            icon={<HistoryIcon className="h-5 w-5" />}
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
            {status === 'all' && total > rows.length ? ` (${total} total)` : ''}
          </p>

          {visible.length === 0 && rows.length === 0 && (
            <Card ariaLabel="No trips">
              <EmptyState
                icon={<HistoryIcon className="h-5 w-5" />}
                title="No trips yet"
                description={
                  status === 'all'
                    ? 'Once you plan a trip it will appear here with its route and schedule.'
                    : `No trips with status “${status}”. Try a different filter.`
                }
                action={
                  status === 'all' ? (
                    <a href={hrefFor('planner')}>
                      <Button>
                        <Plus aria-hidden="true" className="h-4 w-4" />
                        Plan a trip
                      </Button>
                    </a>
                  ) : undefined
                }
              />
            </Card>
          )}

          {visible.length === 0 && rows.length > 0 && (
            <Card ariaLabel="No search results">
              <EmptyState
                icon={<SearchX className="h-5 w-5" />}
                title="No matching trips"
                description="No trip matches your search and filters. Try a shorter search term or clear the date filter."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery('');
                      setFromDate('');
                    }}
                  >
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
