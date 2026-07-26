/**
 * Headline metrics for a completed plan.
 *
 * `total_duration_minutes` is the route's *driving* time (what the routing
 * provider returned), while `total_elapsed_hours` is the whole trip including
 * stops and rest — labelling them apart matters, because they differ and a
 * user comparing them to an ETA needs to know which is which.
 */
import type { PlanSummary, TripStatus } from '../types/api';
import { formatDecimal, formatDuration } from '../lib/format';
import { Badge } from './ui/Badge';
import { tripStatusTone } from '../lib/statusStyles';
import { Card } from './ui/Card';
import { StatTile } from './ui/StatTile';

interface SummaryPanelProps {
  summary: PlanSummary;
  planningStatus: TripStatus;
}

export function SummaryPanel({ summary, planningStatus }: SummaryPanelProps) {
  return (
    <Card
      title="Summary"
      action={<Badge tone={tripStatusTone(planningStatus)}>{planningStatus}</Badge>}
    >
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile
          label="Total miles"
          value={formatDecimal(summary.total_distance_miles)}
          unit="mi"
        />
        <StatTile
          label="Driving time"
          value={
            summary.total_duration_minutes === null
              ? '—'
              : formatDuration(summary.total_duration_minutes)
          }
        />
        <StatTile
          label="Total elapsed"
          value={formatDuration(Number(summary.total_elapsed_hours) * 60)}
        />
        <StatTile label="Driving hours" value={formatDecimal(summary.driving_hours)} unit="h" />
        <StatTile label="On-duty hours" value={formatDecimal(summary.on_duty_hours)} unit="h" />
        <StatTile label="Off-duty hours" value={formatDecimal(summary.off_duty_hours)} unit="h" />
      </dl>
      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        {summary.event_count} timeline events. Driving time is the routed distance at road speed;
        total elapsed includes inspections, loading, breaks and rest. This is a planning projection,
        not an official record of duty status.
      </p>
    </Card>
  );
}
