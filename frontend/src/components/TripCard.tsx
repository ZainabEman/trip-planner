/**
 * One trip, as a scannable row for the history and dashboard lists.
 *
 * The whole card is a single link to the trip's details page — one target, no
 * competing click areas, and it works with middle-click and keyboard.
 *
 * Layout is a three-row read: the route, then the four metrics, then the ID.
 * The route line wraps on narrow screens rather than truncating, because a
 * dispatcher scanning for a city needs to see all three legs.
 */
import {
  ArrowRight,
  BedDouble,
  CalendarClock,
  CalendarPlus,
  CalendarRange,
  ChevronDown,
  Circle,
  Coffee,
  Flag,
  Fuel,
  Gauge,
  ListOrdered,
  MapPin,
  RotateCcw,
  Timer,
  Trash2,
} from 'lucide-react';
import { useId, useState } from 'react';
import type { TimelineEvent, Trip, TripStatus } from '../types/api';
import { formatDateTime, formatDuration, formatMiles } from '../lib/format';
import { analysePlan } from '../lib/planAnalysis';
import { legalityLabel } from '../lib/tripMetrics';
import { tripStatusLabel, tripStatusTone } from '../lib/statusStyles';
import { tripHref } from '../hooks/useHashRoute';
import { Badge } from './ui/Badge';

interface TripCardProps {
  trip: Trip;
  /** Resolved arrival, or undefined while the enrichment pass is still loading. */
  arrival?: string | null;
  /**
   * The stored timeline, when the caller has already fetched it. Enables the
   * inline expansion — days, breaks, resets, fuel — without a second request or
   * a trip to the details page.
   */
  timeline?: TimelineEvent[];
  /** When given, a delete control is shown. Omitted on read-only lists. */
  onDelete?: (trip: Trip) => void;
}

function legalityTone(status: TripStatus) {
  if (status === 'planned') return 'success' as const;
  if (status === 'failed') return 'danger' as const;
  return 'neutral' as const;
}

const LEG_ICON = 'h-3.5 w-3.5 shrink-0 text-slate-400';
const METRIC_ICON = 'h-3.5 w-3.5';

export function TripCard({ trip, arrival, timeline, onDelete }: TripCardProps) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const composition = timeline && timeline.length > 0 ? analysePlan(timeline) : null;

  const legs = [
    { icon: <Circle className={LEG_ICON} />, label: 'Origin', value: trip.current_location_text },
    { icon: <MapPin className={LEG_ICON} />, label: 'Pickup', value: trip.pickup_location_text },
    { icon: <Flag className={LEG_ICON} />, label: 'Delivery', value: trip.dropoff_location_text },
  ];

  const metrics = [
    {
      icon: <Gauge className={METRIC_ICON} />,
      label: 'Distance',
      value: formatMiles(trip.total_distance_miles),
    },
    {
      icon: <Timer className={METRIC_ICON} />,
      label: 'Driving',
      value:
        trip.total_duration_minutes !== null ? formatDuration(trip.total_duration_minutes) : '—',
    },
    {
      icon: <CalendarClock className={METRIC_ICON} />,
      label: 'Arrival',
      // `undefined` means the enrichment pass has not resolved yet; `null` means
      // there is no arrival to show. They must not look the same.
      value: arrival ? formatDateTime(arrival) : arrival === null ? '—' : '…',
    },
    {
      icon: <CalendarPlus className={METRIC_ICON} />,
      label: 'Created',
      value: formatDateTime(trip.created_at),
    },
  ];

  return (
    <li className="relative">
      <a
        href={tripHref(trip.id)}
        className={[
          'group block border border-gray-200 bg-white p-5 shadow-sm transition-colors hover:border-blue-300',
          // The composition strip below carries the bottom corners when present.
          composition ? 'rounded-t-xl' : 'rounded-xl',
        ].join(' ')}
      >
        {/* Route */}
        <div
          className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-3 ${onDelete ? 'pr-9' : ''}`}
        >
          <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {legs.map((leg, index) => (
              <li key={leg.label} className="flex items-center gap-2">
                {index > 0 && (
                  <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                )}
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true">{leg.icon}</span>
                  <span className="text-sm font-semibold text-slate-900 group-hover:text-blue-700">
                    <span className="sr-only">{leg.label}: </span>
                    {leg.value}
                  </span>
                </span>
              </li>
            ))}
          </ol>

          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={legalityTone(trip.status)} dot>
              {legalityLabel(trip.status)}
            </Badge>
            <Badge tone={tripStatusTone(trip.status)}>{tripStatusLabel(trip.status)}</Badge>
          </div>
        </div>

        {/* Metrics */}
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-gray-100 pt-3 sm:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <dt className="flex items-center gap-1.5 text-xs text-slate-500">
                <span aria-hidden="true" className="text-slate-400">
                  {metric.icon}
                </span>
                {metric.label}
              </dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums text-slate-900">
                {metric.value}
              </dd>
            </div>
          ))}
        </dl>

        {/* Identity */}
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
          <p className="truncate font-mono text-xs text-slate-400">
            <span className="sr-only">Trip ID: </span>
            {trip.id}
          </p>
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-blue-700">
            View details
            <ArrowRight
              aria-hidden="true"
              className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            />
          </span>
        </div>
      </a>

      {/*
        Plan composition, expandable in place.
        Outside the anchor for the same reason the delete button is: a control
        may not nest inside a link. Rendered only when a timeline is loaded —
        with nothing to show, a disclosure that opens onto an empty box is worse
        than no disclosure.
      */}
      {composition && (
        <div className="rounded-b-xl border-x border-b border-gray-200 bg-slate-50">
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            aria-controls={panelId}
            className="flex min-h-11 w-full items-center justify-between gap-3 px-5 py-2.5 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100"
          >
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1.5">
                <CalendarRange aria-hidden="true" className="h-3.5 w-3.5 text-slate-400" />
                {composition.days} day{composition.days === 1 ? '' : 's'}
              </span>
              {composition.hasRemedies ? (
                <span className="text-slate-500">
                  {composition.breaks} break{composition.breaks === 1 ? '' : 's'} ·{' '}
                  {composition.resets} reset{composition.resets === 1 ? '' : 's'} ·{' '}
                  {composition.fuelStops} fuel
                </span>
              ) : (
                <span className="text-slate-500">No rest required</span>
              )}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={[
                'h-4 w-4 shrink-0 text-slate-400 transition-transform',
                expanded ? 'rotate-180' : '',
              ].join(' ')}
            />
          </button>

          {expanded && (
            <dl
              id={panelId}
              className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-gray-200 px-5 py-4 sm:grid-cols-3 lg:grid-cols-6"
            >
              {[
                {
                  icon: <CalendarRange className={METRIC_ICON} />,
                  label: 'Planning days',
                  value: composition.days,
                },
                {
                  icon: <Coffee className={METRIC_ICON} />,
                  label: '30-min breaks',
                  value: composition.breaks,
                },
                {
                  icon: <BedDouble className={METRIC_ICON} />,
                  label: '10-hr resets',
                  value: composition.resets,
                },
                {
                  icon: <RotateCcw className={METRIC_ICON} />,
                  label: '34-hr restarts',
                  value: composition.restarts,
                },
                {
                  icon: <Fuel className={METRIC_ICON} />,
                  label: 'Fuel stops',
                  value: composition.fuelStops,
                },
                {
                  icon: <ListOrdered className={METRIC_ICON} />,
                  label: 'Events',
                  value: composition.events,
                },
              ].map((item) => (
                <div key={item.label}>
                  <dt className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span aria-hidden="true" className="text-slate-400">
                      {item.icon}
                    </span>
                    {item.label}
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      {/*
        Delete sits outside the anchor — a button may not nest inside a link,
        and the two need separate hit targets. Overlaid on the card's corner,
        with the header padded to keep it clear of the badges.
      */}
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(trip)}
          title={`Delete trip to ${trip.dropoff_location_text}`}
          aria-label={`Delete trip from ${trip.current_location_text} to ${trip.dropoff_location_text}`}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 aria-hidden="true" className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
