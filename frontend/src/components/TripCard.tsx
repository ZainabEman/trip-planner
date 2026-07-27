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
  CalendarClock,
  CalendarPlus,
  Circle,
  Flag,
  Gauge,
  MapPin,
  Timer,
} from 'lucide-react';
import type { Trip, TripStatus } from '../types/api';
import { formatDateTime, formatDecimal, formatDuration } from '../lib/format';
import { legalityLabel } from '../lib/tripMetrics';
import { tripStatusLabel, tripStatusTone } from '../lib/statusStyles';
import { tripHref } from '../hooks/useHashRoute';
import { Badge } from './ui/Badge';

interface TripCardProps {
  trip: Trip;
  /** Resolved arrival, or undefined while the enrichment pass is still loading. */
  arrival?: string | null;
}

function legalityTone(status: TripStatus) {
  if (status === 'planned') return 'success' as const;
  if (status === 'failed') return 'danger' as const;
  return 'neutral' as const;
}

const LEG_ICON = 'h-3.5 w-3.5 shrink-0 text-slate-400';
const METRIC_ICON = 'h-3.5 w-3.5';

export function TripCard({ trip, arrival }: TripCardProps) {
  const legs = [
    { icon: <Circle className={LEG_ICON} />, label: 'Origin', value: trip.current_location_text },
    { icon: <MapPin className={LEG_ICON} />, label: 'Pickup', value: trip.pickup_location_text },
    { icon: <Flag className={LEG_ICON} />, label: 'Delivery', value: trip.dropoff_location_text },
  ];

  const metrics = [
    {
      icon: <Gauge className={METRIC_ICON} />,
      label: 'Distance',
      value: trip.total_distance_miles ? `${formatDecimal(trip.total_distance_miles)} mi` : '—',
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
    <li>
      <a
        href={tripHref(trip.id)}
        className="group block rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-colors hover:border-blue-300"
      >
        {/* Route */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
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
    </li>
  );
}
