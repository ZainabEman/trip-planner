/**
 * The trip's metadata record.
 *
 * Shared by the planner and the trip details page, which previously would have
 * each built this grid inline. Takes the trip plus its timeline so it can show
 * the derived arrival without the caller recomputing it.
 */
import type { RouteLeg, TimelineEvent, Trip } from '../types/api';
import { formatDateTime } from '../lib/format';
import { arrivalTime } from '../lib/tripMetrics';
import { Card } from './ui/Card';

interface TripMetaGridProps {
  trip: Trip;
  timeline: TimelineEvent[];
  route: RouteLeg[];
}

export function TripMetaGrid({ trip, timeline, route }: TripMetaGridProps) {
  const arrival = arrivalTime(timeline);

  const fields = [
    { label: 'Current location', value: trip.current_location_text },
    { label: 'Pickup', value: trip.pickup_location_text },
    { label: 'Delivery', value: trip.dropoff_location_text },
    { label: 'Cycle hours used', value: `${trip.cycle_hours_used} h` },
    { label: 'Trip start', value: formatDateTime(trip.trip_start_time) },
    { label: 'Projected arrival', value: arrival ? formatDateTime(arrival) : '—' },
    { label: 'Route legs', value: String(route.length) },
    { label: 'Created', value: formatDateTime(trip.created_at) },
  ];

  return (
    <Card title="Trip details">
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map((field) => (
          <div key={field.label}>
            <dt className="text-xs font-medium text-slate-500">{field.label}</dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">{field.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 border-t border-gray-200 pt-4">
        <dt className="text-xs font-medium text-slate-500">Trip ID</dt>
        <dd className="mt-1 break-all font-mono text-xs text-slate-600">{trip.id}</dd>
      </div>
    </Card>
  );
}
