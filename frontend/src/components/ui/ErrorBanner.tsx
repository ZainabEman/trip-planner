/**
 * Renders an ApiError using the backend's error envelope.
 *
 * Deliberately shows the API's own `message` verbatim rather than substituting
 * a friendly rewrite: the planning failures it reports are already written for
 * a human ("...exceeding the 14-hour duty window (BR-2)"), and paraphrasing
 * them would lose the rule traceability FR-4.2 exists to provide.
 *
 * Field-scoped validation messages are *not* shown here — those belong next to
 * their inputs, and TripForm routes them there via `ApiError.fieldErrors`.
 */
import { ApiError } from '../../lib/apiClient';
import { Button } from './Button';

interface ErrorBannerProps {
  error: ApiError;
  onRetry?: () => void;
}

/** A short headline that tells the user whose problem this is. */
function headlineFor(error: ApiError): string {
  if (error.statusCode === 0) return 'Cannot reach the server';
  if (error.ruleId) return 'This trip cannot be driven legally';
  switch (error.statusCode) {
    case 400:
      return 'Please check the form';
    case 404:
      return 'Trip not found';
    case 422:
      return 'This trip cannot be planned';
    case 503:
    case 502:
      return 'Routing service unavailable';
    case 500:
      return 'Server error';
    default:
      return 'Something went wrong';
  }
}

export function ErrorBanner({ error, onRetry }: ErrorBannerProps) {
  const { details } = error;
  const location = details.location;
  const route =
    details.origin && details.destination
      ? `${details.origin} → ${details.destination}`
      : undefined;

  return (
    <div
      role="alert"
      className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-5 shadow-lg shadow-black/20"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-sm font-bold text-rose-300"
        >
          !
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-rose-200">{headlineFor(error)}</h3>
          <p className="mt-1 text-sm leading-relaxed text-rose-100/80">{error.message}</p>

          {(error.ruleId || location || route) && (
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
              {error.ruleId && (
                <div className="flex gap-1.5">
                  <dt className="text-rose-300/60">Rule</dt>
                  <dd className="font-mono font-medium text-rose-200">{error.ruleId}</dd>
                </div>
              )}
              {details.evaluator && (
                <div className="flex gap-1.5">
                  <dt className="text-rose-300/60">Detected by</dt>
                  <dd className="font-medium text-rose-200">{details.evaluator}</dd>
                </div>
              )}
              {location && (
                <div className="flex gap-1.5">
                  <dt className="text-rose-300/60">Location</dt>
                  <dd className="font-medium text-rose-200">{location}</dd>
                </div>
              )}
              {route && (
                <div className="flex gap-1.5">
                  <dt className="text-rose-300/60">Route</dt>
                  <dd className="font-medium text-rose-200">{route}</dd>
                </div>
              )}
            </dl>
          )}

          {onRetry && error.isRetryable && (
            <div className="mt-4">
              <Button variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
