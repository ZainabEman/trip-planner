/**
 * Thin fetch wrapper over the planning API.
 *
 * Its one real job is to turn the backend's error envelope into a typed
 * exception, so every caller handles failures the same way and no component
 * has to know the envelope's shape. See docs/api.md → "Error format".
 */
import type {
  ApiErrorDetails,
  ApiErrorEnvelope,
  CreateTripPayload,
  Paginated,
  RouteLeg,
  TimelineEvent,
  Trip,
  TripPlan,
  TripStatus,
} from '../types/api';

const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000/api';

/** Field-scoped validation messages, e.g. `{ cycle_hours_used: ['...'] }`. */
export type FieldErrors = Record<string, string[]>;

export class ApiError extends Error {
  readonly statusCode: number;
  readonly details: ApiErrorDetails;

  constructor(statusCode: number, message: string, details: ApiErrorDetails = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
  }

  /** The business rule that blocked planning, when the failure was a 422 from the HOS engine. */
  get ruleId(): string | undefined {
    return this.details.rule_id;
  }

  /**
   * Per-field validation messages, if this was a field validation error.
   *
   * Only array-valued keys count: `detail`, `rule_id` and friends are strings
   * and belong to the envelope's non-field vocabulary, not to a form input.
   */
  get fieldErrors(): FieldErrors {
    const entries = Object.entries(this.details).filter((entry): entry is [string, string[]] =>
      Array.isArray(entry[1]),
    );
    return Object.fromEntries(entries);
  }

  get isRetryable(): boolean {
    return this.statusCode === 503 || this.statusCode === 502;
  }
}

function isErrorEnvelope(body: unknown): body is ApiErrorEnvelope {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as ApiErrorEnvelope).error === 'object'
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    // fetch only rejects on a genuine network-level failure (server down, DNS,
    // CORS). Surfaced as a 0 so callers can treat it like any other ApiError.
    throw new ApiError(0, 'Could not reach the server. Is the backend running?');
  }

  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    if (isErrorEnvelope(body)) {
      const { status_code, message, details } = body.error;
      throw new ApiError(status_code ?? response.status, message, details ?? {});
    }
    throw new ApiError(response.status, `Request failed with status ${response.status}.`);
  }

  return body as T;
}

export const api = {
  createTrip(payload: CreateTripPayload): Promise<Trip> {
    return request<Trip>('/trips/', { method: 'POST', body: JSON.stringify(payload) });
  },

  /** Runs the full workflow: route, plan, persist. Takes no body (docs/api.md). */
  planTrip(tripId: string): Promise<TripPlan> {
    return request<TripPlan>(`/trips/${tripId}/plan/`, { method: 'POST' });
  },

  /**
   * One page of trips. Server-side `status` filter and `ordering` only —
   * the endpoint has no text search, so free-text filtering is done on the
   * client over the pages already loaded (see `useTrips`).
   */
  listTrips(
    options: { status?: TripStatus; ordering?: string; page?: number } = {},
  ): Promise<Paginated<Trip>> {
    const query = new URLSearchParams();
    if (options.status) query.set('status', options.status);
    query.set('ordering', options.ordering ?? '-created_at');
    if (options.page && options.page > 1) query.set('page', String(options.page));
    return request<Paginated<Trip>>(`/trips/?${query.toString()}`);
  },

  getTrip(tripId: string): Promise<Trip> {
    return request<Trip>(`/trips/${tripId}/`);
  },

  getTimeline(tripId: string): Promise<TimelineEvent[]> {
    return request<TimelineEvent[]>(`/trips/${tripId}/timeline/`);
  },

  getRoute(tripId: string): Promise<RouteLeg[]> {
    return request<RouteLeg[]>(`/trips/${tripId}/route/`);
  },
};

export { API_BASE_URL };
