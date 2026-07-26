"""TripPlanningService — routes a Trip, plans it, and persists the Timeline.

This is the orchestration seam between the three contexts described in
`docs/domain-analysis.md` §9: it calls Routing, hands the resulting geography
to the HOS Compliance Engine, and writes the engine's Timeline through Trip
Persistence. It is the *only* component that talks to all three, which is
what lets each of them stay unaware of the others — the engine still never
imports the ORM, and RoutingService still knows nothing about duty status.

The write is one transaction covering the whole Trip aggregate (Trip status
+ TimelineEvent rows), because FR-4.1's gap-free invariant is only
meaningful if the entire Timeline commits together (domain-analysis.md §8).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction

from apps.planning.choices import DutyStatus, TripStatus
from apps.planning.models import TimelineEvent, Trip
from apps.planning.services.hos.engine import PlanningEngine
from apps.planning.services.hos.evaluators import default_evaluators
from apps.planning.services.hos.models import (
    MINUTES_PER_HOUR,
    EngineEvent,
    PlanningContext,
    RouteLegInput,
)
from apps.planning.services.routing.models import RouteResult
from apps.planning.services.routing.service import RoutingService

logger = logging.getLogger(__name__)

# Quantisers matching the TimelineEvent column definitions, so a value can
# never be silently truncated by the database driver.
_COORDINATE = Decimal('0.000001')  # DecimalField(max_digits=9, decimal_places=6)
_MILES = Decimal('0.01')  # DecimalField(max_digits=8, decimal_places=2)


class TripNotPlannableError(Exception):
    """Raised when the engine cannot produce a compliant Timeline for a Trip.

    The Trip is left persisted with `status=failed` so the failure is
    diagnosable, but no TimelineEvent rows are written — BR-37/NFR-2.4
    require that a non-compliant or partial plan never be stored.

    `rule_id` and `evaluator_name` are carried as separate attributes rather
    than only interpolated into the message so an API layer can surface them
    as structured fields (FR-4.2/BR-33/US-22 traceability) without parsing
    prose back out of a string.
    """

    def __init__(
        self,
        trip_id,
        reason: str,
        rule_id: str | None = None,
        evaluator_name: str | None = None,
    ) -> None:
        self.trip_id = trip_id
        self.reason = reason
        self.rule_id = rule_id
        self.evaluator_name = evaluator_name
        super().__init__(f'Trip {trip_id} could not be planned: {reason}')


@dataclass(frozen=True)
class TripPlanningResult:
    """What one planning run produced.

    `driving_hours`/`on_duty_hours`/`off_duty_hours` are computed from the
    persisted Timeline but **not stored**: `Trip` has no columns for them
    (only `total_distance_miles` and `total_duration_minutes`, both already
    written by RoutingService). They are returned here so the caller has
    them without a second pass, and because they are exactly the aggregates
    the future TripSummary projection needs (domain-analysis.md §3.9, which
    specifies TripSummary as generated-on-read, never persisted).
    """

    trip: Trip
    event_count: int
    driving_hours: Decimal
    on_duty_hours: Decimal
    off_duty_hours: Decimal
    total_elapsed_hours: Decimal


class TripPlanningService:
    def __init__(
        self,
        routing_service: RoutingService | None = None,
        engine: PlanningEngine | None = None,
    ) -> None:
        self._routing_service = routing_service or RoutingService()
        self._engine = engine or PlanningEngine(evaluators=default_evaluators())

    def plan_trip(self, trip: Trip) -> TripPlanningResult:
        """Route, plan and persist one Trip end to end.

        Raises RoutingError (or a subclass) if the route cannot be computed,
        or TripNotPlannableError if a compliant Timeline cannot be produced.
        """
        route = self._routing_service.plan_route_for_trip(trip)

        result = self._engine.plan(self._build_context(trip, route))

        if not result.events:
            blocking = self._blocking_result(result)
            reason = (
                blocking.reason if blocking is not None
                else 'The engine produced no timeline events.'
            )
            logger.warning('Trip %s could not be planned: %s', trip.id, reason)
            self._mark_failed(trip)
            raise TripNotPlannableError(
                trip.id,
                reason,
                rule_id=blocking.rule_id if blocking is not None else None,
                evaluator_name=blocking.evaluator_name if blocking is not None else None,
            )

        self._persist(trip, result.events)
        return self._summarise(trip, result.events)

    @staticmethod
    def _build_context(trip: Trip, route: RouteResult) -> PlanningContext:
        """Translate the Trip row + routing DTOs into the engine's input shape.

        Coordinates come from the in-memory `RouteResult`, not from the
        persisted `RouteLeg` rows: `RouteLeg` stores endpoint *names* and an
        encoded polyline but no latitude/longitude columns, so the geocoded
        points only exist on this side of the routing call. That is why
        planning runs in the same request as routing rather than as a later
        pass over stored legs.
        """
        return PlanningContext(
            trip_id=trip.id,
            current_location_text=trip.current_location_text,
            pickup_location_text=trip.pickup_location_text,
            dropoff_location_text=trip.dropoff_location_text,
            trip_start_time=trip.trip_start_time,
            cycle_hours_used=trip.cycle_hours_used,
            route_legs=tuple(
                RouteLegInput(
                    sequence=leg.sequence,
                    origin_text=leg.origin.resolved_name,
                    destination_text=leg.destination.resolved_name,
                    origin_latitude=leg.origin.latitude,
                    origin_longitude=leg.origin.longitude,
                    destination_latitude=leg.destination.latitude,
                    destination_longitude=leg.destination.longitude,
                    distance_miles=leg.distance_miles,
                    duration_minutes=leg.duration_minutes,
                )
                for leg in route.legs
            ),
        )

    @staticmethod
    def _blocking_result(result):
        """Find the RuleResult that stopped the plan, if there was one.

        The engine returns no events when a leg is blocked, and the blocking
        RuleResult is the last one it recorded — the evaluator loop stops at
        the first block, so scanning from the end finds it immediately.

        Returns None for the defensive case of an empty timeline with no
        block recorded (e.g. no evaluators registered and a route whose only
        leg has zero duration), which is an engine defect rather than a
        legitimately unplannable trip.
        """
        return next(
            (rule_result for rule_result in reversed(result.rule_results) if not rule_result.allowed),
            None,
        )

    @staticmethod
    @transaction.atomic
    def _mark_failed(trip: Trip) -> None:
        """Mark the Trip failed and drop any Timeline it used to have.

        Clearing the events matters on a *re-plan*: a trip that previously
        planned successfully already has rows, and leaving them behind would
        mean `status=failed` alongside a full timeline that no longer
        reflects a valid plan — `GET /trips/{id}/timeline/` returns exactly
        what is stored, so a stale plan would be served as the current one.
        Failed and planned must be mutually exclusive states.
        """
        trip.timeline_events.all().delete()
        trip.status = TripStatus.FAILED
        trip.save(update_fields=['status', 'updated_at'])

    @transaction.atomic
    def _persist(self, trip: Trip, events: tuple[EngineEvent, ...]) -> None:
        """Write the Timeline and flip the Trip to planned, atomically.

        Re-planning replaces the previous Timeline rather than editing it —
        trips are regenerated, not mutated (A-24), which is the same policy
        RoutingService applies to RouteLegs.
        """
        trip.timeline_events.all().delete()

        TimelineEvent.objects.bulk_create(
            [
                TimelineEvent(
                    trip=trip,
                    # Sequence comes straight from TimelineBuilder; this
                    # service never renumbers or reorders.
                    sequence=event.sequence,
                    start_time=event.start_time,
                    end_time=event.end_time,
                    duty_status=event.duty_status,
                    event_type=event.event_type,
                    location_name=event.location_name,
                    latitude=Decimal(str(event.latitude)).quantize(
                        _COORDINATE, rounding=ROUND_HALF_UP
                    ),
                    longitude=Decimal(str(event.longitude)).quantize(
                        _COORDINATE, rounding=ROUND_HALF_UP
                    ),
                    distance_miles=(
                        None
                        if event.distance_miles is None
                        else event.distance_miles.quantize(_MILES, rounding=ROUND_HALF_UP)
                    ),
                    reason=event.reason,
                )
                for event in events
            ]
        )

        trip.status = TripStatus.PLANNED
        trip.save(update_fields=['status', 'updated_at'])

    @staticmethod
    def _summarise(trip: Trip, events: tuple[EngineEvent, ...]) -> TripPlanningResult:
        """Aggregate duty-status hours over the finished Timeline.

        A pure projection, run strictly after the Timeline is complete —
        never a decision the simulation needed to make
        (docs/hos-engine-design.md §3, SummaryCalculator).
        """
        hours_by_status: dict[str, Decimal] = {}
        for event in events:
            minutes = Decimal((event.end_time - event.start_time).total_seconds()) / Decimal('60')
            hours = minutes / MINUTES_PER_HOUR
            hours_by_status[event.duty_status] = hours_by_status.get(
                event.duty_status, Decimal('0')
            ) + hours

        elapsed = (
            Decimal((events[-1].end_time - events[0].start_time).total_seconds())
            / Decimal('3600')
        )

        return TripPlanningResult(
            trip=trip,
            event_count=len(events),
            driving_hours=hours_by_status.get(DutyStatus.DRIVING, Decimal('0')),
            on_duty_hours=hours_by_status.get(DutyStatus.ON_DUTY_NOT_DRIVING, Decimal('0')),
            # Sleeper berth is a structurally valid status the v1 policy never
            # selects (A-7/A-10), so it is folded in here rather than reported
            # separately — if it is ever emitted it belongs in this total.
            off_duty_hours=(
                hours_by_status.get(DutyStatus.OFF_DUTY, Decimal('0'))
                + hours_by_status.get(DutyStatus.SLEEPER_BERTH, Decimal('0'))
            ),
            total_elapsed_hours=elapsed,
        )
