/**
 * The trip's headline numbers.
 *
 * Total distance and total duration lead, because they answer "how far" and
 * "how long" — the two questions a dispatcher asks first. The duty-hour
 * breakdown follows.
 *
 * `total_duration_minutes` is the route's *driving* time as returned by the
 * routing provider; `total_elapsed_hours` is the whole trip including stops and
 * rest. They differ, so both are shown under distinct labels.
 */
import { Clock, Gauge, ListOrdered, Moon, Route, Truck, Wrench } from 'lucide-react';
import type { PlanSummary, TripStatus } from '../types/api';
import { formatDecimal, formatDuration } from '../lib/format';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { StatTile } from './ui/StatTile';
import { tripStatusLabel, tripStatusTone } from '../lib/statusStyles';

interface SummaryCardProps {
  summary: PlanSummary;
  planningStatus: TripStatus;
}

const ICON = 'h-3.5 w-3.5';

export function SummaryCard({ summary, planningStatus }: SummaryCardProps) {
  const isLegal = planningStatus === 'planned';

  return (
    <Card
      title="Trip summary"
      action={
        <div className="flex items-center gap-2">
          <Badge tone={isLegal ? 'success' : 'danger'} size="md" dot>
            {isLegal ? 'Legal' : 'Not legal'}
          </Badge>
          <Badge tone={tripStatusTone(planningStatus)} size="md">
            {tripStatusLabel(planningStatus)}
          </Badge>
        </div>
      }
    >
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          label="Total distance"
          value={formatDecimal(summary.total_distance_miles)}
          unit="mi"
          icon={<Route className={ICON} />}
          emphasis
        />
        <StatTile
          label="Total duration"
          value={formatDuration(Number(summary.total_elapsed_hours) * 60)}
          icon={<Clock className={ICON} />}
          emphasis
        />
        <StatTile
          label="Driving hours"
          value={formatDecimal(summary.driving_hours)}
          unit="h"
          icon={<Truck className={ICON} />}
        />
        <StatTile
          label="On-duty hours"
          value={formatDecimal(summary.on_duty_hours)}
          unit="h"
          icon={<Wrench className={ICON} />}
        />
        <StatTile
          label="Off-duty hours"
          value={formatDecimal(summary.off_duty_hours)}
          unit="h"
          icon={<Moon className={ICON} />}
        />
        <StatTile
          label="Timeline events"
          value={summary.event_count}
          icon={<ListOrdered className={ICON} />}
        />
      </dl>

      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-slate-500">
        <Gauge aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Driving time on the road is{' '}
          <strong className="font-semibold text-slate-700">
            {summary.total_duration_minutes === null
              ? '—'
              : formatDuration(summary.total_duration_minutes)}
          </strong>
          . Total duration adds inspections, loading, breaks and rest.
        </span>
      </p>
    </Card>
  );
}
