/**
 * The planner page.
 *
 * Section order follows the information priority: trip status, summary, planning
 * activity, then timeline and map side by side, with the trip record last. The
 * form stays at the top because it is the control that produces everything below
 * it — before a plan exists there is no status to show, and after one exists a
 * dispatcher re-plans from the same place.
 *
 * All workflow state lives in `useTripPlanner`; this component only decides what
 * to render for the current phase. The result panels are the same components the
 * trip details page uses, so a fresh plan and a stored one look identical.
 */
import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { tripHref } from '../hooks/useHashRoute';
import { useTripPlanner } from '../hooks/useTripPlanner';
import { buildPlanSteps } from '../lib/planSteps';
import { PlanningActivityLog } from '../components/PlanningActivityLog';
import { PlanningErrorCard } from '../components/PlanningErrorCard';
import { DutyStatusGraph } from '../components/DutyStatusGraph';
import { RoutePanel } from '../components/RoutePanel';
import { SummaryCard } from '../components/SummaryCard';
import { TimelineList } from '../components/TimelineList';
import { TripForm } from '../components/TripForm';
import { TripInformationCard } from '../components/TripInformationCard';
import { TripStatusBar } from '../components/TripStatusBar';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';

const SUBMIT_LABELS = {
  idle: 'Generate plan',
  creating: 'Creating trip…',
  planning: 'Planning…',
  done: 'Re-plan trip',
  error: 'Try again',
} as const;

export function TripPlannerPage() {
  const { phase, plan, error, isBusy, submit, retry } = useTripPlanner();
  const steps = useMemo(() => buildPlanSteps(phase, error, plan), [phase, error, plan]);

  const showActivity = phase !== 'idle';
  const showResults = Boolean(plan) && !isBusy;

  return (
    <div className="space-y-6">
      <TripForm
        onSubmit={submit}
        busy={isBusy}
        fieldErrors={error?.fieldErrors}
        submitLabel={SUBMIT_LABELS[phase]}
      />

      {/* 1 — Trip status */}
      {isBusy && <TripStatusBar kind="planning" />}
      {showResults && plan && <TripStatusBar kind="legal" plan={plan} />}
      {phase === 'error' && error && (
        <TripStatusBar
          kind="illegal"
          reason={
            error.ruleId
              ? 'The schedule would break a federal hours-of-service limit.'
              : 'The trip could not be planned. See the details below.'
          }
        />
      )}

      {/* 2 — Summary */}
      {showResults && plan && (
        <SummaryCard summary={plan.summary} planningStatus={plan.planning_status} />
      )}

      {/* 3 — Planning activity */}
      {showActivity && <PlanningActivityLog steps={steps} />}

      {phase === 'error' && error && <PlanningErrorCard error={error} onRetry={retry} />}

      {/* 4 — Duty status graph */}
      {showResults && plan && <DutyStatusGraph events={plan.timeline} />}

      {/* 5 & 6 — Timeline beside the map on desktop, stacked below it */}
      {showResults && plan && (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <TimelineList events={plan.timeline} />
          <RoutePanel route={plan.route} timeline={plan.timeline} />
        </div>
      )}

      {/* 6 — Trip record, with a permanent link to this trip */}
      {showResults && plan && (
        <>
          <TripInformationCard trip={plan.trip} timeline={plan.timeline} route={plan.route} />
          <p className="px-1">
            <a
              href={tripHref(plan.trip.id)}
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-blue-700 hover:text-blue-800"
            >
              Open this trip&apos;s permanent page
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
            </a>
          </p>
        </>
      )}

      {/* Idle */}
      {phase === 'idle' && (
        <Card ariaLabel="Getting started">
          <EmptyState
            illustration="trips"
            title="No trip planned yet"
            description="Create a trip to generate a legal driving schedule with route, breaks and rest periods."
          />
        </Card>
      )}
    </div>
  );
}
