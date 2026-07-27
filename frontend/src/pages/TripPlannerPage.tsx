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
import { useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { tripHref } from '../hooks/useHashRoute';
import { useTripPlanner } from '../hooks/useTripPlanner';
import { buildNarrative } from '../lib/planAnalysis';
import { buildPlanSteps } from '../lib/planSteps';
import { PlannerNarrative } from '../components/PlannerNarrative';
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
  /** Event highlighted across the graph, the timeline and the decision list. */
  const [selected, setSelected] = useState<number | null>(null);

  const narrative = useMemo(
    () =>
      plan
        ? buildNarrative(plan.timeline, {
            routeLegs: plan.route.length,
            distanceMiles: plan.summary.total_distance_miles,
          })
        : [],
    [plan],
  );

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
        // An hours-of-service block is a genuine "not legal"; anything else —
        // a location that will not geocode, a provider outage — leaves the trip
        // simply unplanned, and must not be reported as a rule violation.
        <TripStatusBar
          kind={error.ruleId ? 'illegal' : 'unplanned'}
          reason={
            error.ruleId
              ? 'Every legal rest was inserted and the delivery still could not be reached within the limits.'
              : 'The route could not be built, so the hours-of-service rules were never reached. See the details below.'
          }
        />
      )}

      {/* 2 — Summary */}
      {showResults && plan && (
        <SummaryCard
          summary={plan.summary}
          planningStatus={plan.planning_status}
          timeline={plan.timeline}
        />
      )}

      {/* 3 — Planning activity: request stages, then scheduling decisions */}
      {showActivity && (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <PlanningActivityLog steps={steps} />
          {showResults && plan && (
            <PlannerNarrative
              entries={narrative}
              selectedSequence={selected}
              onSelect={setSelected}
            />
          )}
        </div>
      )}

      {phase === 'error' && error && <PlanningErrorCard error={error} onRetry={retry} />}

      {/* 4 — Duty status graph */}
      {showResults && plan && (
        <DutyStatusGraph
          events={plan.timeline}
          selectedSequence={selected}
          onSelect={(event) => setSelected(event ? event.sequence : null)}
        />
      )}

      {/* 5 & 6 — Timeline beside the map on desktop, stacked below it */}
      {showResults && plan && (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <TimelineList
            events={plan.timeline}
            selectedSequence={selected}
            onSelect={setSelected}
          />
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
