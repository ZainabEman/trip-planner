/**
 * Deleting a trip, with the confirmation and feedback that go with it.
 *
 * Extracted so the history page and the dashboard delete a trip the same way.
 * They previously could not share it: only history had the flow at all, so the
 * dashboard's recent-trips list and its KPI counts could sit stale beside a
 * trip that no longer existed.
 *
 * The optimistic step is the point. `removeLocally` drops the row from the
 * loaded set the instant the server confirms, so the list, the KPI counts and
 * the analytics — all derived from that same set — update together in one
 * render. The refetch that follows only reconciles with the server; the UI does
 * not wait on it.
 *
 * On failure nothing is removed, the dialog stays open with the reason, and the
 * caller's data is untouched — the delete simply did not happen.
 */
import { useCallback, useState } from 'react';
import { ApiError, api } from '../lib/apiClient';
import type { Trip } from '../types/api';

/** How long the success notice lingers before clearing itself. */
const NOTICE_MS = 4000;

interface UseTripDeletionOptions {
  /** Drop the row from the loaded set immediately (the optimistic update). */
  removeLocally: (tripId: string) => void;
  /** Refetch, to reconcile with the server after the optimistic removal. */
  reload: () => void;
}

export function useTripDeletion({ removeLocally, reload }: UseTripDeletionOptions) {
  const [pending, setPending] = useState<Trip | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const request = useCallback((trip: Trip) => {
    setError(null);
    setPending(trip);
  }, []);

  const cancel = useCallback(() => {
    setPending(null);
    setError(null);
  }, []);

  const confirm = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteTrip(pending.id);
      removeLocally(pending.id);
      setNotice(`Trip to ${pending.dropoff_location_text} deleted.`);
      setPending(null);
      reload();
      window.setTimeout(() => setNotice(null), NOTICE_MS);
    } catch (cause) {
      // A trip already gone is not a failure — the outcome the user asked for
      // has been achieved, and reporting an error would be misleading.
      if (cause instanceof ApiError && cause.statusCode === 404) {
        removeLocally(pending.id);
        setNotice('That trip had already been deleted.');
        setPending(null);
        reload();
        window.setTimeout(() => setNotice(null), NOTICE_MS);
      } else {
        setError(
          cause instanceof ApiError && cause.statusCode !== 0
            ? cause.message
            : 'Could not delete this trip. Check your connection and try again.',
        );
      }
    } finally {
      setBusy(false);
    }
  }, [pending, removeLocally, reload]);

  return { pending, busy, error, notice, request, cancel, confirm };
}
