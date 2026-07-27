/**
 * Failure presentation, written for a driver.
 *
 * The API's own `message` is precise but regulatory ("Driving 20h would bring
 * elapsed duty-window time to 23.25h, exceeding the 14-hour duty window
 * (BR-2)."). That belongs in the record, not in the headline — so the card
 * leads with a plain-language explanation and what to do about it, and tucks
 * the verbatim API text into "Show technical details".
 *
 * Mapping is by rule id and status code, both of which the backend already
 * sends; nothing here needs a new API field.
 */
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';
import { ApiError } from '../lib/apiClient';
import { explanationFor, readClock } from '../lib/hosExplanations';
import { Button } from './ui/Button';
import { Disclosure } from './ui/Disclosure';

interface PlanningErrorCardProps {
  error: ApiError;
  onRetry?: () => void;
}

interface Friendly {
  title: string;
  reason: string;
  suggestion: string;
}

/** Plain-language explanation per business rule. */
const RULE_EXPLANATIONS: Record<string, Friendly> = {
  'BR-1': {
    title: 'Trip cannot be completed legally',
    reason: 'The trip needs more than 11 hours of driving in a single duty period.',
    suggestion: 'Split the load across two days, add a co-driver, or choose a closer delivery.',
  },
  'BR-2': {
    title: 'Trip cannot be completed legally',
    reason: 'The trip exceeds the 14-hour duty window.',
    suggestion:
      'A driver may not drive more than 14 hours after coming on duty, even with breaks. Try a shorter delivery or plan a 10-hour reset partway.',
  },
  'BR-4': {
    title: 'Trip cannot be completed legally',
    reason: 'The trip needs more than 8 hours of driving without a 30-minute break.',
    suggestion: 'A 30-minute break is required before driving again.',
  },
  'BR-8': {
    title: 'Trip cannot be completed legally',
    reason: 'The driver has no hours left in the 70-hour, 8-day cycle.',
    suggestion: 'A 34-hour restart clears the cycle. Try again with the restart scheduled first.',
  },
  'BR-19': {
    title: 'Trip cannot be completed legally',
    reason: 'The trip runs more than 1,000 miles without a fuel stop.',
    suggestion: 'A fuel stop is needed before that point.',
  },
};

function friendlyFor(error: ApiError): Friendly {
  if (error.ruleId && RULE_EXPLANATIONS[error.ruleId]) {
    return RULE_EXPLANATIONS[error.ruleId];
  }

  if (error.statusCode === 0) {
    return {
      title: 'Cannot reach the server',
      reason: 'The planner could not connect to the scheduling service.',
      suggestion: 'Check your connection and try again. If it persists, contact support.',
    };
  }

  if (error.details.location) {
    return {
      title: 'Location not found',
      reason: `We could not find “${error.details.location}” on the map.`,
      suggestion: 'Try adding the state — for example “Springfield, IL” instead of “Springfield”.',
    };
  }

  if (error.details.origin && error.details.destination) {
    return {
      title: 'No drivable route',
      reason: `There is no road route between ${error.details.origin} and ${error.details.destination}.`,
      suggestion:
        'Check the locations. Routes across water or outside the road network are not supported.',
    };
  }

  switch (error.statusCode) {
    case 400:
      return {
        title: 'Check the trip details',
        reason: 'One or more entries could not be accepted.',
        suggestion: 'Review the highlighted fields above and submit again.',
      };
    case 404:
      return {
        title: 'Trip not found',
        reason: 'This trip no longer exists.',
        suggestion: 'Enter the details again to create a new trip.',
      };
    case 502:
    case 503:
      return {
        title: 'Mapping service unavailable',
        reason: 'The routing provider is not responding right now.',
        suggestion: 'This is usually brief. Try again in a moment.',
      };
    case 500:
      return {
        title: 'Server error',
        reason: 'Something went wrong on our side while planning this trip.',
        suggestion: 'Try again. If it keeps happening, contact support.',
      };
    case 422:
      return {
        title: 'Trip cannot be completed legally',
        reason: 'No schedule exists that stays within the hours-of-service limits.',
        suggestion: 'Try a shorter delivery, or reduce the hours already used in the cycle.',
      };
    default:
      return {
        title: 'Something went wrong',
        reason: 'The trip could not be planned.',
        suggestion: 'Try again, or contact support if the problem continues.',
      };
  }
}

export function PlanningErrorCard({ error, onRetry }: PlanningErrorCardProps) {
  const friendly = friendlyFor(error);
  const rule = explanationFor(error.ruleId);
  const clock = rule ? readClock(error.message, rule) : null;
  const isOffline = error.statusCode === 0;
  const Icon = isOffline ? WifiOff : AlertTriangle;

  return (
    <section
      aria-label="Planning problem"
      role="alert"
      className="overflow-hidden rounded-xl border border-red-200 bg-white shadow-sm"
    >
      <div className="flex items-start gap-3 border-b border-red-100 bg-red-50 px-5 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-white">
          <Icon aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{friendly.title}</h2>
          <p className="mt-0.5 text-sm text-slate-600">{friendly.reason}</p>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        {/*
          When the block came from a named rule we can say considerably more
          than the generic branches below: what the limit is, how much of it was
          already spent, what was attempted, and which remedy clears it. All of
          it is derived from `rule_id` plus the engine's own message — see
          lib/hosExplanations.ts.
        */}
        {rule && (
          <div className="rounded-lg border border-gray-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h3 className="text-sm font-semibold text-slate-900">{rule.name}</h3>
              <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-xs font-medium text-slate-600 ring-1 ring-gray-200">
                {rule.ruleId}
              </span>
              <span className="text-xs text-slate-500">Limit: {rule.limit}</span>
            </div>

            <dl className="mt-3 space-y-2.5 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  What happened
                </dt>
                <dd className="mt-0.5 leading-relaxed text-slate-700">{rule.what}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Why it happened
                </dt>
                <dd className="mt-0.5 leading-relaxed text-slate-700">{rule.why}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  What the planner did
                </dt>
                <dd className="mt-0.5 leading-relaxed text-slate-700">
                  Stopped before the limit was broken and returned no schedule, rather than
                  producing an illegal plan. The legal remedy is a{' '}
                  <strong className="font-semibold">{rule.remedyLabel}</strong>, which this version
                  does not yet insert automatically.
                </dd>
              </div>
            </dl>

            {clock && (
              <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-gray-200 pt-3 sm:grid-cols-4">
                {[
                  { label: 'Already used', value: clock.used },
                  { label: 'Remaining', value: clock.remaining, emphasis: true },
                  { label: 'Needed for this leg', value: clock.attempted },
                  { label: 'Would reach', value: clock.projected, over: true },
                ].map((item) => (
                  <div key={item.label}>
                    <dt className="text-xs text-slate-500">{item.label}</dt>
                    <dd
                      className={[
                        'mt-0.5 text-sm font-semibold tabular-nums',
                        item.over
                          ? 'text-red-700'
                          : item.emphasis
                            ? 'text-blue-700'
                            : 'text-slate-900',
                      ].join(' ')}
                    >
                      {item.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      {clock.unit === 'h' ? ' h' : ' mi'}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            <p className="mt-3 border-t border-gray-200 pt-3 text-sm leading-relaxed text-slate-700">
              <span className="font-semibold">What to do: </span>
              {rule.suggestion}
            </p>
          </div>
        )}

        <dl className={rule ? 'hidden' : 'space-y-3'}>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</dt>
            <dd className="mt-1 text-sm leading-relaxed text-slate-700">{friendly.reason}</dd>
          </div>
          {error.ruleId && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rule</dt>
              <dd className="mt-1">
                <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-sm font-medium text-slate-700">
                  {error.ruleId}
                </span>
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              What to try
            </dt>
            <dd className="mt-1 text-sm leading-relaxed text-slate-700">{friendly.suggestion}</dd>
          </div>
        </dl>

        {onRetry && error.isRetryable && (
          <Button variant="secondary" onClick={onRetry}>
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Try again
          </Button>
        )}

        <div className="border-t border-gray-200 pt-1">
          <Disclosure summary="Show technical details">
            <dl className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs">
              <div>
                <dt className="font-medium text-slate-500">Status code</dt>
                <dd className="mt-0.5 font-mono text-slate-700">
                  {error.statusCode === 0 ? 'network error' : error.statusCode}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">API message</dt>
                <dd className="mt-0.5 leading-relaxed text-slate-700">{error.message}</dd>
              </div>
              {error.details.evaluator && (
                <div>
                  <dt className="font-medium text-slate-500">Detected by</dt>
                  <dd className="mt-0.5 font-mono text-slate-700">{error.details.evaluator}</dd>
                </div>
              )}
              {error.details.trip_id && (
                <div>
                  <dt className="font-medium text-slate-500">Trip ID</dt>
                  <dd className="mt-0.5 break-all font-mono text-slate-700">
                    {error.details.trip_id}
                  </dd>
                </div>
              )}
            </dl>
          </Disclosure>
        </div>
      </div>
    </section>
  );
}
