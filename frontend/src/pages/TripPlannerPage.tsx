/**
 * The Trip Planner page: form on the left, results on the right.
 *
 * All workflow state lives in `useTripPlanner`; this component only decides
 * what to render for the current phase. Keeping the two apart is what lets the
 * result panels stay presentational and reusable.
 */
import { useTripPlanner } from '../hooks/useTripPlanner';
import { RouteMap, RouteMapLegend } from '../components/RouteMap';
import { SummaryPanel } from '../components/SummaryPanel';
import { TimelineList } from '../components/TimelineList';
import { TripForm } from '../components/TripForm';
import { Card } from '../components/ui/Card';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { Spinner } from '../components/ui/Spinner';
import { formatDateTime } from '../lib/format';

const PHASE_LABELS = {
  idle: 'Generate plan',
  creating: 'Creating trip…',
  planning: 'Planning…',
  done: 'Generate plan',
  error: 'Try again',
} as const;

function PlanningProgress({ phase }: { phase: 'creating' | 'planning' }) {
  return (
    <Card>
      <div className="flex items-center gap-4 py-8">
        <span className="text-sky-400">
          <Spinner size="lg" label="Generating plan" />
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-200">
            {phase === 'creating' ? 'Creating the trip…' : 'Generating the plan…'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {phase === 'creating'
              ? 'Saving your inputs.'
              : 'Geocoding locations, computing the route, and applying the hours-of-service rules. This can take a few seconds.'}
          </p>
        </div>
      </div>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card>
      <div className="py-16 text-center">
        <p className="text-sm font-medium text-slate-300">No plan yet</p>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-slate-500">
          Enter the current, pickup and dropoff locations along with the hours already used in the
          driver&apos;s 70-hour cycle. The plan will show the route, a compliant schedule, and the
          projected arrival.
        </p>
      </div>
    </Card>
  );
}

export function TripPlannerPage() {
  const { phase, plan, error, isBusy, submit, retry } = useTripPlanner();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/40">
        <div className="mx-auto flex max-w-7xl flex-wrap items-baseline justify-between gap-2 px-6 py-5">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">Truck Trip Planner</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              FMCSA hours-of-service trip planning &middot; 49 CFR Part 395
            </p>
          </div>
          <p className="text-xs text-slate-500">Times shown in UTC</p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="space-y-6">
            <TripForm
              onSubmit={submit}
              busy={isBusy}
              fieldErrors={error?.fieldErrors}
              submitLabel={PHASE_LABELS[phase]}
            />
            {plan && (
              <Card title="Trip">
                <dl className="space-y-2.5 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Start</dt>
                    <dd className="text-right text-slate-300">
                      {formatDateTime(plan.trip.trip_start_time)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Cycle used</dt>
                    <dd className="text-slate-300">{plan.trip.cycle_hours_used} h</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Arrival</dt>
                    <dd className="text-right text-slate-300">
                      {plan.timeline.length > 0
                        ? formatDateTime(plan.timeline[plan.timeline.length - 1].end_time)
                        : '—'}
                    </dd>
                  </div>
                  <div className="border-t border-slate-800 pt-2.5">
                    <dt className="text-xs text-slate-500">Trip ID</dt>
                    <dd className="mt-0.5 break-all font-mono text-xs text-slate-400">
                      {plan.trip.id}
                    </dd>
                  </div>
                </dl>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            {error && <ErrorBanner error={error} onRetry={retry} />}

            {isBusy && <PlanningProgress phase={phase as 'creating' | 'planning'} />}

            {!isBusy && !plan && !error && <EmptyState />}

            {plan && !isBusy && (
              <>
                <SummaryPanel summary={plan.summary} planningStatus={plan.planning_status} />
                <Card title="Route" action={<RouteMapLegend />} flush>
                  <RouteMap route={plan.route} timeline={plan.timeline} />
                </Card>
                <TimelineList events={plan.timeline} />
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
