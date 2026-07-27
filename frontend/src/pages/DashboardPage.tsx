/**
 * Landing page for dispatchers.
 *
 * Deliberately not a metrics dashboard: a dispatcher arriving here either wants
 * to plan the next load or open a trip they planned earlier. So the page is one
 * primary CTA, the five most recent trips, and links to the reference material —
 * nothing that needs interpreting.
 */
import { ArrowRight, BookOpen, History, LifeBuoy, Plus, Route as RouteIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { hrefFor, paths } from '../hooks/useHashRoute';
import { useTrips } from '../hooks/useTrips';
import { TripCard } from '../components/TripCard';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Spinner } from '../components/ui/Spinner';

const RECENT_COUNT = 5;

interface ShortcutProps {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
}

function Shortcut({ href, icon, title, description }: ShortcutProps) {
  return (
    <a
      href={href}
      className="group flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-colors hover:border-blue-300"
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-sm font-semibold text-slate-900">
          {title}
          <ArrowRight
            aria-hidden="true"
            className="h-3.5 w-3.5 text-slate-400 transition-transform group-hover:translate-x-0.5"
          />
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{description}</span>
      </span>
    </a>
  );
}

export function DashboardPage() {
  const { rows, total, loading, error } = useTrips({ enrich: true, limit: RECENT_COUNT });

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
              Plan a compliant trip
            </h1>
            <p className="mt-2 text-base leading-relaxed text-slate-600">
              Enter three locations and the hours already used in the driver&apos;s 70-hour cycle.
              You get a route, a legal schedule with every required break, and a projected arrival.
            </p>
          </div>
          <a href={hrefFor('planner')} className="shrink-0">
            <Button size="lg">
              <Plus aria-hidden="true" className="h-4 w-4" />
              Start planning
            </Button>
          </a>
        </div>
      </section>

      {/* Shortcuts */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Shortcut
          href={hrefFor('history')}
          icon={<History className="h-4.5 w-4.5" />}
          title="Trip history"
          description={
            total > 0 ? `${total} trip${total === 1 ? '' : 's'} planned` : 'Every trip you have run'
          }
        />
        <Shortcut
          href={hrefFor('hos')}
          icon={<BookOpen className="h-4.5 w-4.5" />}
          title="Hours of Service"
          description="The five federal limits, in plain terms"
        />
        <Shortcut
          href={hrefFor('support')}
          icon={<LifeBuoy className="h-4.5 w-4.5" />}
          title="Support"
          description="How planning works and how to report a problem"
        />
      </div>

      {/* Recent trips */}
      <Card
        title="Recent trips"
        description="Your five most recent plans"
        action={
          total > RECENT_COUNT ? (
            <a
              href={hrefFor('history')}
              className="flex min-h-9 items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-800"
            >
              View all
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </a>
          ) : undefined
        }
      >
        {loading && (
          <div className="flex items-center justify-center gap-3 py-10 text-slate-500">
            <span className="text-blue-600">
              <Spinner label="Loading recent trips" />
            </span>
            <span className="text-sm">Loading trips…</span>
          </div>
        )}

        {!loading && error && (
          <EmptyState
            icon={<RouteIcon className="h-5 w-5" />}
            title="Could not load trips"
            description={
              error.statusCode === 0
                ? 'The planner could not reach the server. Check that the backend is running.'
                : error.message
            }
            compact
          />
        )}

        {!loading && !error && rows.length === 0 && (
          <EmptyState
            icon={<RouteIcon className="h-5 w-5" />}
            title="No trips yet"
            description="Plan your first trip to see it here."
            action={
              <a href={hrefFor('planner')}>
                <Button>
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  Start planning
                </Button>
              </a>
            }
          />
        )}

        {!loading && !error && rows.length > 0 && (
          <ul className="space-y-3">
            {rows.map((row) => (
              <TripCard key={row.trip.id} trip={row.trip} arrival={row.arrival} />
            ))}
          </ul>
        )}
      </Card>

      <p className="px-1 text-xs text-slate-500">
        Bookmarkable links: the planner is at <code className="font-mono">#{paths.planner}</code>,
        history at <code className="font-mono">#{paths.history}</code>, and each trip at{' '}
        <code className="font-mono">#/trips/&lt;id&gt;</code>.
      </p>
    </div>
  );
}
