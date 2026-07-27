/**
 * One trip, as a scannable row for the history and dashboard lists.
 *
 * The whole card is a single link to the trip's details page — one target, no
 * competing click areas, and it works with middle-click and keyboard.
 */
import { ArrowRight, Calendar, Clock, Gauge, MapPin } from 'lucide-react';
import type { Trip, TripStatus } from '../types/api';
import { formatDateTime, formatDecimal, formatDuration } from '../lib/format';
import { legalityLabel } from '../lib/tripMetrics';
import { tripStatusLabel, tripStatusTone } from '../lib/statusStyles';
import { tripHref } from '../hooks/useHashRoute';
import { Badge } from './ui/Badge';

interface TripCardProps {
  trip: Trip;
  /** Resolved arrival, or undefined while the second pass is still loading. */
  arrival?: string | null;
}

function legalityTone(status: TripStatus) {
  if (status === 'planned') return 'success' as const;
  if (status === 'failed') return 'danger' as const;
  return 'neutral' as const;
}

export function TripCard({ trip, arrival }: TripCardProps) {
  const metrics = [
    {
      icon: <Gauge className="h-3.5 w-3.5" />,
      label: 'Distance',
      value: trip.total_distance_miles ? `${formatDecimal(trip.total_distance_miles)} mi` : '—',
    },
    {
      icon: <Clock className="h-3.5 w-3.5" />,
      label: 'Driving',
      value:
        trip.total_duration_minutes !== null ? formatDuration(trip.total_duration_minutes) : '—',
    },
    {
      icon: <Calendar className="h-3.5 w-3.5" />,
      label: 'Arrival',
      value: arrival ? formatDateTime(arrival) : arrival === null ? '—' : '…',
    },
  ];

  return (
    <li>
      <a
        href={tripHref(trip.id)}
        className="group block rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-colors hover:border-blue-300"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {/* Route line: the primary thing a dispatcher scans for. */}
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-slate-900">
              <MapPin aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
              <span>{trip.current_location_text}</span>
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-300" />
              <span>{trip.pickup_location_text}</span>
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-300" />
              <span>{trip.dropoff_location_text}</span>
            </p>
            <p className="mt-1.5 text-xs text-slate-500">
              Created {formatDateTime(trip.created_at)}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={legalityTone(trip.status)} dot>
              {legalityLabel(trip.status)}
            </Badge>
            <Badge tone={tripStatusTone(trip.status)}>{tripStatusLabel(trip.status)}</Badge>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-gray-100 pt-3">
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

        <p className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-3">
          <span className="truncate font-mono text-xs text-slate-400">{trip.id}</span>
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-blue-700">
            View details
            <ArrowRight
              aria-hidden="true"
              className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            />
          </span>
        </p>
      </a>
    </li>
  );
}
