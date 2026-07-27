/**
 * Planning activity log — a record of what the *planner* did.
 *
 * Deliberately not the trip timeline: this describes the four stages of the
 * planning request (trip saved, route fetched, rules evaluated, timeline
 * built), whereas TimelineList describes the driver's day. They are shown as
 * separate panels because they answer different questions — "did planning
 * work?" versus "what does the driver do?".
 *
 * Step states and details come from `buildPlanSteps`, which derives everything
 * from the API response and error payloads. See that module for why stages 2–4
 * resolve together.
 */
import { AlertCircle, Check } from 'lucide-react';
import type { PlanStep } from '../lib/planSteps';
import { stepsComplete } from '../lib/planSteps';
import { Card } from './ui/Card';
import { Spinner } from './ui/Spinner';

/** Text an assistive technology reads for a step's state. */
const STATE_TEXT: Record<PlanStep['state'], string> = {
  pending: 'not started',
  active: 'in progress',
  complete: 'done',
  failed: 'failed',
};

function StepMarker({ state }: { state: PlanStep['state'] }) {
  if (state === 'complete') {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-white">
        <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white">
        <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white">
        <Spinner size="sm" label={null} />
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-gray-200 bg-white">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-slate-300" />
    </span>
  );
}

const LABEL_STYLES: Record<PlanStep['state'], string> = {
  complete: 'text-slate-900',
  active: 'font-semibold text-slate-900',
  failed: 'font-semibold text-red-700',
  pending: 'text-slate-400',
};

export function PlanningActivityLog({ steps }: { steps: PlanStep[] }) {
  const allDone = stepsComplete(steps);
  const failed = steps.some((step) => step.state === 'failed');

  return (
    <Card title="Planning activity" description="What happened while building this plan">
      {/* Announced as it changes, without stealing focus. */}
      <ol aria-live="polite" className="space-y-0">
        {steps.map((step, index) => (
          <li key={step.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <StepMarker state={step.state} />
              {index < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={[
                    'w-0.5 flex-1',
                    step.state === 'complete' ? 'bg-green-200' : 'bg-gray-200',
                  ].join(' ')}
                />
              )}
            </div>
            <div className={index < steps.length - 1 ? 'min-w-0 flex-1 pb-4' : 'min-w-0 flex-1'}>
              <p className={['text-sm', LABEL_STYLES[step.state]].join(' ')}>
                {step.label}
                <span className="sr-only"> — {STATE_TEXT[step.state]}</span>
              </p>
              {step.detail && (
                <p
                  className={[
                    'mt-0.5 text-xs',
                    step.state === 'failed' ? 'text-red-600' : 'text-slate-500',
                  ].join(' ')}
                >
                  {step.detail}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>

      {allDone && (
        <p className="mt-2 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">
          <Check aria-hidden="true" className="h-4 w-4" strokeWidth={3} />
          Planning complete
        </p>
      )}
      {failed && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          Planning stopped — see the details below.
        </p>
      )}
    </Card>
  );
}
