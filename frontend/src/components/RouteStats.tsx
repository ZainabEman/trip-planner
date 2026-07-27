/**
 * The numbers that belong beside a map: how far, how long, where it ends.
 *
 * Deadhead and loaded miles come from `RouteLeg.leg_type`, which is exactly the
 * distinction a dispatcher cares about — unpaid repositioning versus revenue
 * miles. Stops counts non-driving timeline events, i.e. everywhere the truck
 * actually stops.
 */
import { Flag, Fuel, MapPin, Route as RouteIcon, Truck } from 'lucide-react';
import type { RouteLeg, TimelineEvent } from '../types/api';
import { formatDateTime, formatDecimal } from '../lib/format';
import { arrivalTime } from '../lib/tripMetrics';

interface RouteStatsProps {
  route: RouteLeg[];
  timeline: TimelineEvent[];
}

function milesFor(route: RouteLeg[], legType: RouteLeg['leg_type']): number {
  return route
    .filter((leg) => leg.leg_type === legType)
    .reduce((total, leg) => total + Number(leg.distance_miles), 0);
}

export function RouteStats({ route, timeline }: RouteStatsProps) {
  const deadhead = milesFor(route, 'deadhead');
  const loaded = milesFor(route, 'loaded');
  const total = deadhead + loaded;
  const arrival = arrivalTime(timeline);
  // Everything that is not a driving segment is a stop the truck makes.
  const stops = timeline.filter((event) => event.event_type !== 'drive').length;

  const stats = [
    {
      icon: <Truck className="h-3.5 w-3.5" />,
      label: 'Deadhead',
      value: `${formatDecimal(deadhead.toFixed(2))} mi`,
      hint: 'Current location → pickup, unloaded',
    },
    {
      icon: <Fuel className="h-3.5 w-3.5" />,
      label: 'Loaded',
      value: `${formatDecimal(loaded.toFixed(2))} mi`,
      hint: 'Pickup → delivery, under load',
    },
    {
      icon: <RouteIcon className="h-3.5 w-3.5" />,
      label: 'Total',
      value: `${formatDecimal(total.toFixed(2))} mi`,
      hint: 'Both legs combined',
    },
    {
      icon: <Flag className="h-3.5 w-3.5" />,
      label: 'Est. arrival',
      value: arrival ? formatDateTime(arrival) : '—',
      hint: 'End of the last scheduled event',
    },
    {
      icon: <MapPin className="h-3.5 w-3.5" />,
      label: 'Stops',
      value: String(stops),
      hint: 'Inspections, loading, breaks and rest',
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-gray-200 px-5 py-4 sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((stat) => (
        <div key={stat.label} title={stat.hint}>
          <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <span aria-hidden="true" className="text-slate-400">
              {stat.icon}
            </span>
            {stat.label}
          </dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}
