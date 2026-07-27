/**
 * Shape-matched loading placeholders, one per panel that loads.
 *
 * Each mirrors the real component's layout closely enough that nothing jumps
 * when the data arrives — that is the whole reason to prefer these over a
 * spinner. They live together so a layout change and its placeholder stay
 * adjacent in review.
 */
import { Skeleton, SkeletonRegion } from './ui/Skeleton';
import { Card } from './ui/Card';

/** Mirrors TripCard. */
export function TripCardSkeleton() {
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4 max-w-sm" />
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="flex shrink-0 gap-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4 border-t border-gray-100 pt-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
      <div className="mt-3 border-t border-gray-100 pt-3">
        <Skeleton className="h-3 w-56" />
      </div>
    </li>
  );
}

export function TripListSkeleton({
  rows = 4,
  label = 'Loading trips',
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <SkeletonRegion label={label}>
      <ul className="space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <TripCardSkeleton key={i} />
        ))}
      </ul>
    </SkeletonRegion>
  );
}

/** Mirrors the KPI row + analytics grid + activity feed. */
export function DashboardSkeleton() {
  return (
    <SkeletonRegion label="Loading dashboard">
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-8" />
              </div>
              <Skeleton className="mt-3 h-8 w-16" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>

        <Card title="Fleet analytics">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-2 h-6 w-16" />
              </div>
            ))}
          </div>
        </Card>

        <Card title="Operations activity">
          <div className="space-y-4">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton circle className="h-7 w-7" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-64" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </SkeletonRegion>
  );
}

/** Mirrors the history summary row + card list. */
export function HistorySkeleton() {
  return (
    <SkeletonRegion label="Loading trip history">
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-7 w-12" />
            </div>
          ))}
        </div>
        <ul className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <TripCardSkeleton key={i} />
          ))}
        </ul>
      </div>
    </SkeletonRegion>
  );
}

/** Mirrors SummaryCard's six stat tiles. */
export function SummarySkeleton() {
  return (
    <SkeletonRegion label="Loading trip summary">
      <Card title="Trip summary">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="rounded-lg border border-gray-200 p-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-6 w-14" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-4 h-3 w-2/3" />
      </Card>
    </SkeletonRegion>
  );
}

/** Mirrors TimelineList's journey rows. */
export function TimelineSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <SkeletonRegion label="Loading timeline">
      <Card title="Timeline">
        <ul className="space-y-5">
          {Array.from({ length: rows }, (_, i) => (
            <li key={i} className="flex gap-4">
              <Skeleton circle className="h-10 w-10 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-56" />
                <Skeleton className="h-3 w-32" />
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </SkeletonRegion>
  );
}
