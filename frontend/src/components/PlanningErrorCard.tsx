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
import { AlertTriangle, ArrowRight, Lightbulb, RefreshCw, WifiOff } from 'lucide-react';
import { ApiError } from '../lib/apiClient';
import { explanationFor, readClock } from '../lib/hosExplanations';
import { suggestionsFor } from '../lib/plannerSuggestions';
import { Button } from './ui/Button';
import { Disclosure } from './ui/Disclosure';

interface PlanningErrorCardProps {
  error: ApiError;
  onRetry?: () => void;
}

interface Friendly {
  title: string;
  reason: string;
}

/** Plain-language explanation per business rule. */
const RULE_EXPLANATIONS: Record<string, Friendly> = {
  'BR-1': {
    title: 'Trip cannot be completed legally',
    reason: 'The trip needs more than 11 hours of driving in a single duty period.',
  },
  'BR-2': {
    title: 'Trip cannot be completed legally',
    reason: 'The trip exceeds the 14-hour duty window.',
  },
  'BR-4': {
    title: 'Trip cannot be completed legally',
    reason: 'The trip needs more than 8 hours of driving without a 30-minute break.',
  },
  'BR-8': {
    title: 'Trip cannot be completed legally',
    reason: 'The driver has no hours left in the 70-hour, 8-day cycle.',
  },
  'BR-19': {
    title: 'Trip cannot be completed legally',
    reason: 'The trip runs more than 1,000 miles without a fuel stop.',
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
    };
  }

  if (error.details.location) {
    return {
      title: 'Location not found',
      reason: `We could not find “${error.details.location}” on the map.`,
    };
  }

  if (error.details.origin && error.details.destination) {
    return {
      title: 'No drivable route',
      reason: `There is no road route between ${error.details.origin} and ${error.details.destination}.`,
    };
  }

  switch (error.statusCode) {
    case 400:
      return {
        title: 'Check the trip details',
        reason: 'One or more entries could not be accepted.',
      };
    case 404:
      return {
        title: 'Trip not found',
        reason: 'This trip no longer exists.',
      };
    case 502:
    case 503:
      return {
        title: 'Mapping service unavailable',
        reason: 'The routing provider is not responding right now.',
      };
    case 500:
      return {
        title: 'Server error',
        reason: 'Something went wrong on our side while planning this trip.',
      };
    case 422:
      return {
        title: 'Trip cannot be completed legally',
        reason: 'No schedule exists that stays within the hours-of-service limits.',
      };
    default:
      return {
        title: 'Something went wrong',
        reason: 'The trip could not be planned.',
      };
  }
}

/**
 * The actionable half of the card.
 *
 * Split out from the prose above because the two answer different questions:
 * that explains why the plan failed, this says what to change. The list is
 * chosen by `suggestionsFor` from the rule id or the error shape, so a cycle
 * failure and a geocoding failure never offer the same advice.
 *
 * Note what is deliberately *not* here any more: "take a 30-minute break",
 * "schedule a 10-hour reset". The planner inserts those itself now, so a trip
 * that still fails has already had them — advising them would be telling the
 * dispatcher to do something that has been done.
 */
function SuggestionPanel({ error }: { error: ApiError }) {
  const { headline, suggestions } = suggestionsFor(error);

  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50/60 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Lightbulb aria-hidden="true" className="h-4 w-4 text-blue-700" />
        What to try
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-700">{headline}</p>
      <ul className="mt-3 space-y-2.5">
        {suggestions.map((suggestion) => (
          <li key={suggestion.action} className="flex gap-2.5">
            <ArrowRight
              aria-hidden="true"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-700"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">{suggestion.action}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                {suggestion.rationale}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
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
                  Inserted every legal remedy it could — the applicable one here is a{' '}
                  <strong className="font-semibold">{rule.remedyLabel}</strong> — and still could
                  not reach the delivery inside the limits. Rather than return an illegal plan it
                  returned none, so the trip needs a change to its inputs.
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

          </div>
        )}

        {!rule && (
          <dl className="space-y-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Reason
              </dt>
              <dd className="mt-1 text-sm leading-relaxed text-slate-700">{friendly.reason}</dd>
            </div>
          </dl>
        )}

        {/* What a dispatcher can actually do, tailored to the blocking rule. */}
        <SuggestionPanel error={error} />

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
