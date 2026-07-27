/**
 * The trip's full record — the reference block of a dispatch report.
 *
 * Replaces the earlier TripMetaGrid: same job, but it now carries the duty-hour
 * breakdown as well, so the printed report is self-contained and the planner and
 * details pages share one component instead of two similar ones.
 *
 * Grouped into identity / locations / times / distance-and-hours because that is
 * the order someone reads a report in, not the order the API returns fields.
 */
import type { ReactNode } from 'react';
import { formatDateTime, formatDecimal, formatDuration } from '../lib/format';
import { arrivalTime, summaryFromStored } from '../lib/tripMetrics';
import { tripStatusLabel, tripStatusTone } from '../lib/statusStyles';
import { legalityLabel } from '../lib/tripMetrics';
import type { RouteLeg, TimelineEvent, Trip } from '../types/api';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { CopyButton } from './ui/CopyButton';

interface TripInformationCardProps {
  trip: Trip;
  timeline: TimelineEvent[];
  route: RouteLeg[];
}

interface Field {
  label: string;
  value: ReactNode;
  /** Render in a monospace face — ids and coordinates. */
  mono?: boolean;
}

function Group({ heading, fields }: { heading: string; fields: Field[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{heading}</h3>
      <dl className="mt-2.5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.label} className="min-w-0">
            <dt className="text-xs text-slate-500">{field.label}</dt>
            <dd
              className={[
                'mt-0.5 text-sm font-medium text-slate-900',
                field.mono ? 'break-all font-mono text-xs' : '',
              ].join(' ')}
            >
              {field.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function TripInformationCard({ trip, timeline, route }: TripInformationCardProps) {
  const summary = summaryFromStored(trip, timeline);
  const arrival = arrivalTime(timeline);
  const hasTimeline = timeline.length > 0;

  return (
    <Card
      title="Trip information"
      description="The complete record for this trip"
      action={
        <span className="no-print">
          <CopyButton value={trip.id} what="trip ID" showLabel />
        </span>
      }
    >
      <div className="space-y-6">
        <Group
          heading="Identity"
          fields={[
            { label: 'Trip ID', value: trip.id, mono: true },
            {
              label: 'Status',
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={tripStatusTone(trip.status)}>{tripStatusLabel(trip.status)}</Badge>
                  <Badge
                    tone={
                      trip.status === 'planned'
                        ? 'success'
                        : trip.status === 'failed'
                          ? 'danger'
                          : 'neutral'
                    }
                    dot
                  >
                    {legalityLabel(trip.status)}
                  </Badge>
                </span>
              ),
            },
          ]}
        />

        <Group
          heading="Locations"
          fields={[
            { label: 'Current location', value: trip.current_location_text },
            { label: 'Pickup', value: trip.pickup_location_text },
            { label: 'Delivery', value: trip.dropoff_location_text },
            { label: 'Route legs', value: String(route.length) },
          ]}
        />

        <Group
          heading="Times"
          fields={[
            { label: 'Trip start', value: formatDateTime(trip.trip_start_time) },
            { label: 'Created', value: formatDateTime(trip.created_at) },
            // `updated_at` is set by the last save, which for a planned trip is
            // the planning run — the closest thing the API has to "last planned".
            { label: 'Last planned', value: formatDateTime(trip.updated_at) },
            { label: 'Estimated arrival', value: arrival ? formatDateTime(arrival) : '—' },
          ]}
        />

        <Group
          heading="Distance and hours"
          fields={[
            {
              label: 'Distance',
              value: trip.total_distance_miles
                ? `${formatDecimal(trip.total_distance_miles)} mi`
                : '—',
            },
            {
              label: 'Driving hours',
              value: hasTimeline
                ? `${formatDecimal(summary.driving_hours)} h`
                : trip.total_duration_minutes !== null
                  ? formatDuration(trip.total_duration_minutes)
                  : '—',
            },
            {
              label: 'On-duty hours',
              value: hasTimeline ? `${formatDecimal(summary.on_duty_hours)} h` : '—',
            },
            {
              label: 'Off-duty hours',
              value: hasTimeline ? `${formatDecimal(summary.off_duty_hours)} h` : '—',
            },
            {
              label: 'Elapsed hours',
              value: hasTimeline ? `${formatDecimal(summary.total_elapsed_hours)} h` : '—',
            },
            { label: 'Cycle hours used at start', value: `${trip.cycle_hours_used} h` },
          ]}
        />

        {!hasTimeline && (
          <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
            Duty-hour totals need a stored schedule. This trip has no timeline, so only the values
            recorded on the trip itself are shown.
          </p>
        )}
      </div>
    </Card>
  );
}
