/**
 * TypeScript mirrors of the REST API shapes documented in docs/api.md.
 *
 * Decimal-valued fields arrive as *strings*, not numbers — DRF serialises
 * DecimalField that way to avoid float precision loss. They are typed as
 * `string` here deliberately: parse at the point of use rather than pretending
 * they are numbers.
 */

export type DutyStatus = 'off_duty' | 'sleeper_berth' | 'driving' | 'on_duty_not_driving';

export type EventType =
  | 'drive'
  | 'pickup'
  | 'dropoff'
  | 'fuel'
  | 'rest_break_30'
  | 'daily_rest_10'
  | 'cycle_restart_34'
  | 'pretrip_inspection'
  | 'posttrip_inspection';

export type TripStatus = 'pending' | 'planned' | 'failed';

export type LegType = 'deadhead' | 'loaded';

export interface Trip {
  id: string;
  current_location_text: string;
  pickup_location_text: string;
  dropoff_location_text: string;
  cycle_hours_used: string;
  trip_start_time: string;
  status: TripStatus;
  total_distance_miles: string | null;
  total_duration_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export interface RouteLeg {
  id: number;
  trip: string;
  sequence: number;
  leg_type: LegType;
  origin_text: string;
  destination_text: string;
  distance_miles: string;
  duration_minutes: number;
  /** Encoded polyline (precision 5) as returned by the routing provider. */
  encoded_polyline: string;
}

export interface TimelineEvent {
  id: number;
  trip: string;
  sequence: number;
  start_time: string;
  end_time: string;
  duty_status: DutyStatus;
  event_type: EventType;
  location_name: string;
  latitude: string;
  longitude: string;
  distance_miles: string | null;
  reason: string;
}

export interface PlanSummary {
  event_count: number;
  driving_hours: string;
  on_duty_hours: string;
  off_duty_hours: string;
  total_elapsed_hours: string;
  total_distance_miles: string | null;
  total_duration_minutes: number | null;
}

/** Response body of `POST /api/trips/{id}/plan/`. */
export interface TripPlan {
  planning_status: TripStatus;
  trip: Trip;
  route: RouteLeg[];
  timeline: TimelineEvent[];
  summary: PlanSummary;
}

/** DRF PageNumberPagination envelope, as returned by `GET /api/trips/`. */
export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Payload accepted by `POST /api/trips/`. */
export interface CreateTripPayload {
  current_location_text: string;
  pickup_location_text: string;
  dropoff_location_text: string;
  cycle_hours_used: string;
  trip_start_time: string;
}

/**
 * The `details` object from the API's error envelope.
 *
 * Validation errors key it by field name with an array of messages; non-field
 * errors use `detail`. Planning failures add `rule_id`/`evaluator`, and
 * routing failures add `location` or `origin`/`destination`.
 */
export interface ApiErrorDetails {
  detail?: string;
  rule_id?: string;
  evaluator?: string;
  trip_id?: string;
  location?: string;
  origin?: string;
  destination?: string;
  [field: string]: string | string[] | undefined;
}

export interface ApiErrorEnvelope {
  error: {
    status_code: number;
    message: string;
    details: ApiErrorDetails;
  };
}
