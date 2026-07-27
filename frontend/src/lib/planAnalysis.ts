/**
 * What the plan actually says, derived from the timeline.
 *
 * The engine schedules multi-day trips with automatic remedies — 30-minute
 * breaks, 10-hour resets, 34-hour restarts, fuel stops — but the API's shape has
 * not changed: `POST /plan/` still returns a flat `timeline` array and a summary
 * of duty hours. Everything the dispatcher views need beyond that (which day is
 * which, how many breaks were inserted, what the planner did and in what order)
 * is recoverable from that array, so it is recovered here rather than added to
 * the wire format.
 *
 * **Nothing in this module invents an event.** Every entry it produces
 * corresponds one-to-one with a timeline event the engine emitted. The narrative
 * in particular is a faithful reconstruction of the backend's own activity log —
 * the engine records "drove a segment / inserted a remedy / resumed" and this
 * reads the same story back out of the events those steps produced. Where the
 * backend knows something the timeline does not carry (the exact rule id behind
 * a remedy), the citation is read from the event's own `reason` text rather than
 * guessed.
 *
 * Days are keyed by the UTC calendar day an event **starts** in. The engine's
 * own `PlanningDay` grouping puts a midnight-crossing event in both days it
 * touches, which is right for a per-day duty log — but wrong for a sequential
 * list, where showing a 10-hour rest twice reads as two rests. The duty graph
 * does slice across midnight; see `DutyStatusGraph`.
 */
import type { EventType, TimelineEvent } from '../types/api';
import { extractRuleIds } from './eventMeta';
import { durationMinutes, formatDate } from './format';

/* ------------------------------------------------------------------ *
 * Event classification
 * ------------------------------------------------------------------ */

/** Event types the planner inserts to make an otherwise illegal trip legal. */
export const REMEDY_EVENT_TYPES = [
  'rest_break_30',
  'daily_rest_10',
  'cycle_restart_34',
  'fuel',
] as const;

export type RemedyEventType = (typeof REMEDY_EVENT_TYPES)[number];

export function isRemedy(type: EventType): type is RemedyEventType {
  return (REMEDY_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Visual family for an event.
 *
 * Coarser than `event_type` and orthogonal to `duty_status`: a fuel stop and a
 * pickup are both On Duty (Not Driving), but only one of them is something the
 * *planner* inserted, and a dispatcher scanning a timeline wants to tell those
 * apart at a glance. Drives the accent colouring in the timeline.
 */
export type EventFamily = 'drive' | 'break' | 'rest' | 'fuel' | 'work';

export function eventFamily(type: EventType): EventFamily {
  switch (type) {
    case 'drive':
      return 'drive';
    case 'rest_break_30':
      return 'break';
    case 'daily_rest_10':
    case 'cycle_restart_34':
      return 'rest';
    case 'fuel':
      return 'fuel';
    default:
      return 'work';
  }
}

/* ------------------------------------------------------------------ *
 * Multi-day grouping
 * ------------------------------------------------------------------ */

export interface PlanDay {
  /** 1-based, in chronological order — the "DAY 2" a dispatcher says out loud. */
  dayNumber: number;
  /** `Jul 27`, formatted in UTC to match every other timestamp in the app. */
  label: string;
  events: TimelineEvent[];
  drivingMinutes: number;
  onDutyMinutes: number;
  offDutyMinutes: number;
  distanceMiles: number;
  /** Elapsed minutes from the trip's first event to this day's last event. */
  cumulativeMinutes: number;
}

export function groupIntoDays(timeline: TimelineEvent[]): PlanDay[] {
  if (timeline.length === 0) return [];

  const tripStart = timeline[0].start_time;
  const byLabel = new Map<string, TimelineEvent[]>();

  for (const event of timeline) {
    const label = formatDate(event.start_time);
    const bucket = byLabel.get(label);
    if (bucket) bucket.push(event);
    else byLabel.set(label, [event]);
  }

  // Insertion order is chronological because the timeline is: the API returns
  // events ordered by sequence, and the engine's sequence is chronological.
  return [...byLabel.entries()].map(([label, events], index) => {
    let drivingMinutes = 0;
    let onDutyMinutes = 0;
    let offDutyMinutes = 0;
    let distanceMiles = 0;

    for (const event of events) {
      const minutes = durationMinutes(event.start_time, event.end_time);
      if (event.duty_status === 'driving') drivingMinutes += minutes;
      else if (event.duty_status === 'on_duty_not_driving') onDutyMinutes += minutes;
      else offDutyMinutes += minutes;
      if (event.distance_miles) distanceMiles += Number(event.distance_miles);
    }

    return {
      dayNumber: index + 1,
      label,
      events,
      drivingMinutes,
      onDutyMinutes,
      offDutyMinutes,
      distanceMiles,
      cumulativeMinutes: durationMinutes(tripStart, events[events.length - 1].end_time),
    };
  });
}

/* ------------------------------------------------------------------ *
 * Remedy counts
 * ------------------------------------------------------------------ */

export interface PlanComposition {
  days: number;
  events: number;
  breaks: number;
  resets: number;
  restarts: number;
  fuelStops: number;
  dutyPeriods: number;
  drivingSegments: number;
  /** True when the planner had to insert anything at all to make the trip legal. */
  hasRemedies: boolean;
}

export function analysePlan(timeline: TimelineEvent[]): PlanComposition {
  const count = (type: EventType) =>
    timeline.reduce((total, event) => total + (event.event_type === type ? 1 : 0), 0);

  const breaks = count('rest_break_30');
  const resets = count('daily_rest_10');
  const restarts = count('cycle_restart_34');
  const fuelStops = count('fuel');

  return {
    days: groupIntoDays(timeline).length,
    events: timeline.length,
    breaks,
    resets,
    restarts,
    fuelStops,
    // Each duty period opens with its own pre-trip inspection (BR-21), so
    // counting those counts the periods without re-deriving the rule.
    dutyPeriods: count('pretrip_inspection'),
    drivingSegments: count('drive'),
    hasRemedies: breaks + resets + restarts + fuelStops > 0,
  };
}

/* ------------------------------------------------------------------ *
 * Planner narrative
 * ------------------------------------------------------------------ */

export type NarrativeKind =
  | 'created'
  | 'routed'
  | 'driving'
  | 'remedy'
  | 'resumed'
  | 'arrived'
  | 'failed';

export interface NarrativeEntry {
  id: string;
  kind: NarrativeKind;
  label: string;
  detail?: string;
  /** ISO timestamp this step corresponds to, where the timeline supplies one. */
  at?: string;
  /** Business rule that required a remedy, read from the event's own reason. */
  ruleId?: string;
  /** Timeline sequence, so clicking an entry can highlight the event. */
  sequence?: number;
}

/** What each inserted remedy is called, in the planner's own voice. */
const REMEDY_LABEL: Record<RemedyEventType, string> = {
  rest_break_30: '30-minute break inserted',
  daily_rest_10: '10-hour reset inserted',
  cycle_restart_34: '34-hour restart inserted',
  fuel: 'Fuel stop inserted',
};

/**
 * Rebuild the planner's activity log from the timeline it produced.
 *
 * The backend keeps this narrative itself (`PlanningResult.activity`), but does
 * not serialise it — no field on the plan response carries it, and adding one
 * would change the API contract. The timeline is a complete record of what the
 * planner decided, so the same story is read back from it here.
 *
 * The correspondence is exact, step for step:
 *
 *   engine                     | reconstructed from
 *   ---------------------------|------------------------------------------
 *   trip_created               | the trip row existing
 *   route_generated            | route legs / a stored distance
 *   driving_completed          | each `drive` event
 *   remedy_inserted            | each break / reset / restart / fuel event
 *   planning_resumed           | the drive that follows a remedy
 *   destination_reached        | the final `posttrip_inspection`
 *
 * A remedy with no following drive emits no "resumed" entry, because the
 * planner did not in fact resume — it finished.
 */
export function buildNarrative(
  timeline: TimelineEvent[],
  options: { routeLegs?: number; distanceMiles?: string | null; failedReason?: string } = {},
): NarrativeEntry[] {
  const entries: NarrativeEntry[] = [];
  const { routeLegs, distanceMiles, failedReason } = options;

  entries.push({
    id: 'created',
    kind: 'created',
    label: 'Trip created',
    detail: 'Origin, pickup, delivery and cycle hours saved',
    at: timeline[0]?.start_time,
  });

  if (routeLegs !== undefined || distanceMiles) {
    entries.push({
      id: 'routed',
      kind: 'routed',
      label: 'Route generated',
      detail: [
        routeLegs !== undefined ? `${routeLegs} leg${routeLegs === 1 ? '' : 's'}` : null,
        distanceMiles ? `${Number(distanceMiles).toFixed(0)} mi` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      at: timeline[0]?.start_time,
    });
  }

  if (timeline.length === 0) {
    if (failedReason) {
      entries.push({
        id: 'failed',
        kind: 'failed',
        label: 'Planning stopped',
        detail: failedReason,
      });
    }
    return entries;
  }

  timeline.forEach((event, index) => {
    if (event.event_type === 'drive') {
      const previous = index > 0 ? timeline[index - 1] : null;
      // A drive immediately after a remedy *is* the planner resuming.
      if (previous && isRemedy(previous.event_type)) {
        entries.push({
          id: `resumed-${event.sequence}`,
          kind: 'resumed',
          label: 'Planning resumed',
          at: event.start_time,
          sequence: event.sequence,
        });
      }
      entries.push({
        id: `driving-${event.sequence}`,
        kind: 'driving',
        label: 'Driving segment completed',
        detail: event.distance_miles
          ? `${Number(event.distance_miles).toFixed(1)} mi to ${event.location_name}`
          : undefined,
        at: event.end_time,
        sequence: event.sequence,
      });
      return;
    }

    if (isRemedy(event.event_type)) {
      entries.push({
        id: `remedy-${event.sequence}`,
        kind: 'remedy',
        label: REMEDY_LABEL[event.event_type],
        detail: event.location_name,
        at: event.start_time,
        // The engine writes the triggering rule into the event's reason, so the
        // citation is real rather than inferred from the event type.
        ruleId: extractRuleIds(event.reason)[0],
        sequence: event.sequence,
      });
    }
  });

  const last = timeline[timeline.length - 1];
  if (last.event_type === 'posttrip_inspection' || last.event_type === 'dropoff') {
    entries.push({
      id: 'arrived',
      kind: 'arrived',
      label: 'Destination reached',
      detail: last.location_name,
      at: last.end_time,
      sequence: last.sequence,
    });
  }

  return entries;
}
