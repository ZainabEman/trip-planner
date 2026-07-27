/**
 * Transient success / failure feedback for an action the user just took.
 *
 * Shared so a deletion reports itself identically on the history page and the
 * dashboard. The live-region role differs by tone on purpose: `alert` interrupts
 * for a failure the user must act on, `status` waits its turn for a confirmation
 * they merely need to hear.
 */
import { Check, TriangleAlert } from 'lucide-react';

export function Notice({ tone, children }: { tone: 'success' | 'error'; children: React.ReactNode }) {
  const success = tone === 'success';
  const Icon = success ? Check : TriangleAlert;

  return (
    <p
      role={success ? 'status' : 'alert'}
      className={[
        'flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium',
        success
          ? 'border-green-200 bg-green-50 text-green-800'
          : 'border-red-200 bg-red-50 text-red-700',
      ].join(' ')}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      {children}
    </p>
  );
}
