/**
 * The map, in its card, with its legend and empty state.
 *
 * Extracted because the planner and the trip details page render an identical
 * panel; keeping the Card/legend/empty-state wiring in one place means the two
 * cannot drift apart.
 */
import type { RouteLeg, TimelineEvent } from '../types/api';
import { RouteMap, RouteMapEmpty, RouteMapLegend } from './RouteMap';
import { Card } from './ui/Card';

interface RoutePanelProps {
  route: RouteLeg[];
  timeline: TimelineEvent[];
  heightClass?: string;
}

export function RoutePanel({ route, timeline, heightClass }: RoutePanelProps) {
  const hasRoute = route.length > 0;

  return (
    <Card
      title="Route"
      description="Deadhead and loaded legs"
      action={hasRoute ? <RouteMapLegend /> : undefined}
      flush={hasRoute}
    >
      {hasRoute ? (
        <RouteMap route={route} timeline={timeline} heightClass={heightClass} />
      ) : (
        <RouteMapEmpty />
      )}
    </Card>
  );
}
