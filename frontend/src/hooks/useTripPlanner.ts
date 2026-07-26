/**
 * The create-then-plan workflow.
 *
 * `POST /trips/` and `POST /trips/{id}/plan/` are two calls, and the second is
 * the slow one (geocoding + routing + planning). They are sequenced here, with
 * a `phase` granular enough for the UI to say which step is running — a single
 * boolean would leave the user watching a spinner with no idea whether it is
 * still talking to the routing provider.
 *
 * Holding the created trip id matters for the failure path: if planning fails
 * the Trip already exists (persisted with `status=failed`), so a retry can
 * re-plan that same trip instead of creating a duplicate.
 */
import { useCallback, useRef, useState } from 'react';
import { ApiError, api } from '../lib/apiClient';
import type { CreateTripPayload, TripPlan } from '../types/api';

export type PlannerPhase = 'idle' | 'creating' | 'planning' | 'done' | 'error';

export interface UseTripPlannerResult {
  phase: PlannerPhase;
  plan: TripPlan | null;
  error: ApiError | null;
  isBusy: boolean;
  submit: (payload: CreateTripPayload) => Promise<void>;
  /** Re-plan the trip already created, without creating another one. */
  retry: () => Promise<void>;
  reset: () => void;
}

export function useTripPlanner(): UseTripPlannerResult {
  const [phase, setPhase] = useState<PlannerPhase>('idle');
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const lastTripId = useRef<string | null>(null);

  const runPlan = useCallback(async (tripId: string) => {
    setPhase('planning');
    const result = await api.planTrip(tripId);
    setPlan(result);
    setPhase('done');
  }, []);

  const toApiError = (cause: unknown): ApiError =>
    cause instanceof ApiError ? cause : new ApiError(0, 'An unexpected error occurred.');

  const submit = useCallback(
    async (payload: CreateTripPayload) => {
      setError(null);
      setPlan(null);
      try {
        setPhase('creating');
        const trip = await api.createTrip(payload);
        lastTripId.current = trip.id;
        await runPlan(trip.id);
      } catch (cause) {
        setError(toApiError(cause));
        setPhase('error');
      }
    },
    [runPlan],
  );

  const retry = useCallback(async () => {
    const tripId = lastTripId.current;
    if (!tripId) return;
    setError(null);
    try {
      await runPlan(tripId);
    } catch (cause) {
      setError(toApiError(cause));
      setPhase('error');
    }
  }, [runPlan]);

  const reset = useCallback(() => {
    lastTripId.current = null;
    setPlan(null);
    setError(null);
    setPhase('idle');
  }, []);

  return {
    phase,
    plan,
    error,
    isBusy: phase === 'creating' || phase === 'planning',
    submit,
    retry,
    reset,
  };
}
