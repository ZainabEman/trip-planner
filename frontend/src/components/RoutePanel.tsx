/**
 * The map, with its stats, legend and empty state.
 *
 * Extracted because the planner and the trip details page render an identical
 * panel; keeping the wiring in one place means the two cannot drift apart.
 */
import type { RouteLeg, TimelineEvent } from '../types/api';
import { isRemedy } from '../lib/planAnalysis';
import { RouteMap, RouteMapEmpty, RouteMapLegend } from './RouteMap';
import { RouteStats } from './RouteStats';
import { Card } from './ui/Card';
import { CopyButton } from './ui/CopyButton';

interface RoutePanelProps {
  route: RouteLeg[];
  timeline: TimelineEvent[];
  heightClass?: string;
}

/** One line per leg, for pasting into a message or a load board. */
function routeAsText(route: RouteLeg[]): string {
  return route
    .map(
      (leg) =>
        `${leg.sequence}. ${leg.origin_text} → ${leg.destination_text} (${leg.leg_type}, ${leg.distance_miles} mi, ${leg.duration_minutes} min)`,
    )
    .join('\n');
}

export function RoutePanel({ route, timeline, heightClass }: RoutePanelProps) {
  const hasRoute = route.length > 0;
  const hasInserted = timeline.some((event) => isRemedy(event.event_type));

  return (
    <Card
      title="Route"
      description={
        hasRoute
          ? hasInserted
            ? 'Deadhead and loaded legs, with the stops the planner inserted'
            : 'Deadhead and loaded legs'
          : undefined
      }
      action={
        hasRoute ? (
          <span className="no-print">
            <CopyButton value={routeAsText(route)} what="route" showLabel />
          </span>
        ) : undefined
      }
      flush
    >
      {hasRoute ? (
        <>
          <RouteStats route={route} timeline={timeline} />
          <RouteMap route={route} timeline={timeline} heightClass={heightClass} />
          <div className="border-t border-gray-200 px-5 py-3">
            <RouteMapLegend hasInserted={hasInserted} />
          </div>
        </>
      ) : (
        <RouteMapEmpty />
      )}
    </Card>
  );
}
