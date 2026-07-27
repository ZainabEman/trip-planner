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
import {
  BedDouble,
  CalendarRange,
  Clock,
  Coffee,
  Fuel,
  Gauge,
  ListOrdered,
  Moon,
  Route,
  RotateCcw,
  Truck,
  Wrench,
} from 'lucide-react';
import type { PlanSummary, TimelineEvent, TripStatus } from '../types/api';
import { formatDecimal, formatDuration } from '../lib/format';
import { analysePlan } from '../lib/planAnalysis';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { StatTile } from './ui/StatTile';
import { tripStatusLabel, tripStatusTone } from '../lib/statusStyles';
import { legalityLabel } from '../lib/tripMetrics';

interface SummaryCardProps {
  summary: PlanSummary;
  planningStatus: TripStatus;
  /**
   * The timeline the summary describes. Supplied wherever it is available, so
   * the card can report the plan's *composition* — how many days, how many
   * breaks and resets the planner had to insert — which the API's `summary`
   * block does not carry and which is the interesting part of a multi-day plan.
   */
  timeline?: TimelineEvent[];
}

const ICON = 'h-3.5 w-3.5';

export function SummaryCard({ summary, planningStatus, timeline }: SummaryCardProps) {
  const isLegal = planningStatus === 'planned';
  const composition = timeline && timeline.length > 0 ? analysePlan(timeline) : null;

  return (
    <Card
      title="Trip summary"
      action={
        <div className="flex items-center gap-2">
          {/* Wording comes from tripMetrics so every legality badge in the app
              says the same thing — notably "Not planned" rather than
              "Not legal" for a trip that simply has not run yet. */}
          <Badge
            tone={isLegal ? 'success' : planningStatus === 'failed' ? 'danger' : 'neutral'}
            size="md"
            dot
          >
            {legalityLabel(planningStatus)}
          </Badge>
          <Badge tone={tripStatusTone(planningStatus)} size="md">
            {tripStatusLabel(planningStatus)}
          </Badge>
        </div>
      }
    >
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {composition && (
          <StatTile
            label="Trip days"
            value={composition.days}
            icon={<CalendarRange className={ICON} />}
            emphasis
          />
        )}
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

      {/*
        What the planner had to insert to make this legal. Shown only when a
        timeline is available and something was in fact inserted — a short legal
        trip needs no remedies, and four zeroes would imply the planner failed
        to do something rather than that nothing was required.
      */}
      {composition?.hasRemedies && (
        <section className="mt-4 rounded-lg border border-gray-200 bg-slate-50 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Inserted to stay compliant
          </h3>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              {
                label: '30-min breaks',
                value: composition.breaks,
                icon: <Coffee className={ICON} />,
              },
              {
                label: '10-hour resets',
                value: composition.resets,
                icon: <BedDouble className={ICON} />,
              },
              {
                label: '34-hour restarts',
                value: composition.restarts,
                icon: <RotateCcw className={ICON} />,
              },
              { label: 'Fuel stops', value: composition.fuelStops, icon: <Fuel className={ICON} /> },
            ].map((item) => (
              <StatTile key={item.label} label={item.label} value={item.value} icon={item.icon} />
            ))}
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Added automatically by the planner across {composition.dutyPeriods} duty period
            {composition.dutyPeriods === 1 ? '' : 's'}, splitting the route into{' '}
            {composition.drivingSegments} driving segment
            {composition.drivingSegments === 1 ? '' : 's'}.
          </p>
        </section>
      )}

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
