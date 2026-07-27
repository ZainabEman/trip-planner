/**
 * The planning activity log — what happened while planning, not what the driver
 * will do. (The driver's schedule is the trip timeline; see TimelineList.)
 *
 * An honesty note on granularity: the workflow is **two** HTTP calls, not four.
 * `POST /trips/` is step 1; `POST /trips/{id}/plan/` performs routing, rule
 * evaluation and timeline construction server-side in a single request, so the
 * client cannot observe when one finishes and the next begins.
 *
 * Rather than fake a timed march through the steps — which would tick
 * "Timeline generated" before the server had generated anything — steps 2–4 are
 * shown as one in-flight group: the earliest incomplete step spins, the rest
 * stay pending, and all three complete together when the response lands.
 *
 * Failure attribution *is* real, and is derived entirely from data the API
 * already sends: a `rule_id` means the HOS check rejected the schedule, a
 * `location`/`origin` detail means routing failed. Nothing here is invented.
 */
import { ApiError } from './apiClient';
import { remedyLabelFor } from './hosExplanations';
import type { PlannerPhase } from '../hooks/useTripPlanner';
import type { TripPlan } from '../types/api';

export type StepState = 'pending' | 'active' | 'complete' | 'failed';

export interface PlanStep {
  id: 'create' | 'route' | 'rules' | 'timeline';
  label: string;
  state: StepState;
  /** Short factual outcome, shown beside the step once it resolves. */
  detail?: string;
}

const LABELS: Record<PlanStep['id'], string> = {
  create: 'Trip created',
  route: 'Route generated',
  rules: 'HOS rules checked',
  timeline: 'Timeline generated',
};

const ORDER: PlanStep['id'][] = ['create', 'route', 'rules', 'timeline'];

/** Which stage an error belongs to, from the error the API returned. */
function failedStage(error: ApiError | null): PlanStep['id'] | null {
  if (!error) return null;
  // A rule violation is reported with the blocking rule's id.
  if (error.ruleId) return 'rules';
  // Geocoding / no-drivable-route / provider failures all happen while routing.
  if (error.details.location || error.details.origin || error.isRetryable) return 'route';
  if (error.statusCode === 422 || error.statusCode === 500 || error.statusCode === 502) {
    return 'route';
  }
  // Anything else (network down, validation on create) failed before routing.
  return 'create';
}

/** Factual per-step detail, taken from the plan response or the error. */
function detailFor(
  id: PlanStep['id'],
  state: StepState,
  plan: TripPlan | null,
  error: ApiError | null,
): string | undefined {
  if (state === 'failed') {
    if (id === 'rules' && error?.ruleId) {
      // Name the remedy the rule calls for, so the log says what is needed
      // rather than only what failed.
      const remedy = remedyLabelFor(error.ruleId);
      return remedy
        ? `Blocked by ${error.ruleId} — needs a ${remedy}`
        : `Blocked by ${error.ruleId}`;
    }
    if (id === 'route' && error?.details.location)
      return `Could not locate ${error.details.location}`;
    if (id === 'route' && error?.details.origin) return 'No drivable route between two points';
    return error?.statusCode === 0 ? 'Server unreachable' : 'Failed';
  }
  if (state !== 'complete' || !plan) return undefined;
  switch (id) {
    case 'create':
      return 'Saved';
    case 'route':
      return `${plan.route.length} legs · ${plan.summary.total_distance_miles ?? '—'} mi`;
    case 'rules':
      return 'No violations';
    case 'timeline':
      return `${plan.summary.event_count} events`;
  }
}

export function buildPlanSteps(
  phase: PlannerPhase,
  error: ApiError | null,
  plan: TripPlan | null = null,
): PlanStep[] {
  const stage = failedStage(error);

  return ORDER.map((id, index) => {
    let state: StepState = 'pending';

    if (phase === 'done') {
      state = 'complete';
    } else if (phase === 'creating') {
      state = index === 0 ? 'active' : 'pending';
    } else if (phase === 'planning') {
      // Step 1 genuinely finished; 2–4 are the single server round-trip.
      state = index === 0 ? 'complete' : index === 1 ? 'active' : 'pending';
    } else if (phase === 'error' && stage) {
      const failedIndex = ORDER.indexOf(stage);
      if (index < failedIndex) state = 'complete';
      else if (index === failedIndex) state = 'failed';
      else state = 'pending';
    }

    return { id, label: LABELS[id], state, detail: detailFor(id, state, plan, error) };
  });
}

export function stepsComplete(steps: PlanStep[]): boolean {
  return steps.every((step) => step.state === 'complete');
}

/**
 * Reconstruct the activity log for a **stored** trip.
 *
 * The live version above reads the in-flight request's phase; this one infers
 * the same four stages from what was persisted, so the details page can show
 * planner activity for a trip planned days ago:
 *
 *  - creation always succeeded, or the row would not exist;
 *  - routing succeeded if route legs were stored;
 *  - the rule check and timeline succeeded if the trip is `planned` with events.
 *
 * A `failed` trip is attributed to the rule check, because that is the only
 * stage that sets `failed` — a routing failure raises before the status is
 * touched and leaves the trip `pending`, which is reported as routing not
 * having completed. The blocking rule id is not on the Trip row, so a
 * historical failure cannot name its rule here.
 */
export function stepsFromStoredTrip(
  trip: { status: string; total_distance_miles: string | null },
  timelineCount: number,
  routeLegCount: number,
): PlanStep[] {
  const routed = routeLegCount > 0 || trip.total_distance_miles !== null;
  const planned = trip.status === 'planned' && timelineCount > 0;
  const failed = trip.status === 'failed';

  const routeState: StepState = routed ? 'complete' : 'pending';
  const rulesState: StepState = planned ? 'complete' : failed ? 'failed' : 'pending';
  const timelineState: StepState = planned ? 'complete' : 'pending';

  return [
    { id: 'create', label: LABELS.create, state: 'complete', detail: 'Saved' },
    {
      id: 'route',
      label: LABELS.route,
      state: routeState,
      detail: routed
        ? `${routeLegCount} legs · ${trip.total_distance_miles ?? '—'} mi`
        : 'No route stored',
    },
    {
      id: 'rules',
      label: LABELS.rules,
      state: rulesState,
      detail: planned ? 'No violations' : failed ? 'Rejected — no legal schedule' : 'Not evaluated',
    },
    {
      id: 'timeline',
      label: LABELS.timeline,
      state: timelineState,
      detail: planned ? `${timelineCount} events` : 'No timeline stored',
    },
  ];
}
