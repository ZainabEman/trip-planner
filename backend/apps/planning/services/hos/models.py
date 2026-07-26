"""Internal DTOs for the HOS engine foundation.

These are plain dataclasses only — never Django models, and this module
never imports `apps.planning.models` (the ORM layer). Whatever data the
engine needs from a persisted Trip/RouteLeg must be extracted into these
shapes by the caller before the engine is invoked, which is what keeps
the engine itself framework- and ORM-independent (PRD NFR-5.1, FR-3.11).

`DutyStatus`/`EventType` are reused from `apps.planning.choices` rather
than duplicated — that module is a lightweight, already-approved
vocabulary (no ORM/database access), and EngineEvent is meant to map
1:1 onto a persisted TimelineEvent row later.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from apps.planning.choices import DutyStatus, EventType
from apps.planning.services.hos.exceptions import (
    InvalidEvaluationContextError,
    InvalidPlanningContextError,
)
from apps.planning.services.hos.state_machine import DutyState

MINUTES_PER_HOUR = Decimal('60')


@dataclass(frozen=True)
class RouteLegInput:
    """The minimal routing data the HOS engine needs, owned by this package
    so it never depends on the routing service's internal DTOs.
    """

    sequence: int
    origin_text: str
    destination_text: str
    origin_latitude: float
    origin_longitude: float
    destination_latitude: float
    destination_longitude: float
    distance_miles: Decimal
    duration_minutes: int

    @property
    def duration_hours(self) -> Decimal:
        return Decimal(self.duration_minutes) / MINUTES_PER_HOUR


@dataclass(frozen=True)
class PlanningContext:
    """Immutable snapshot of everything the engine needs to plan one trip."""

    trip_id: uuid.UUID
    current_location_text: str
    pickup_location_text: str
    dropoff_location_text: str
    trip_start_time: datetime
    cycle_hours_used: Decimal
    route_legs: tuple[RouteLegInput, ...]

    def __post_init__(self) -> None:
        if not self.route_legs:
            raise InvalidPlanningContextError('PlanningContext requires at least one RouteLeg.')
        if self.cycle_hours_used < 0:
            raise InvalidPlanningContextError('cycle_hours_used cannot be negative.')


@dataclass(frozen=True)
class EngineEvent:
    """The engine's internal representation of one timeline event, prior
    to persistence as a TimelineEvent row.
    """

    sequence: int | None
    start_time: datetime
    end_time: datetime
    duty_status: DutyStatus
    event_type: EventType
    location_name: str
    latitude: float
    longitude: float
    reason: str
    distance_miles: Decimal | None = None


@dataclass(frozen=True)
class DutyTransition:
    """A record of the engine's internal state machine moving from one
    DutyState to another (see state_machine.py).
    """

    from_state: DutyState
    to_state: DutyState
    occurred_at: datetime
    reason: str = ''


@dataclass(frozen=True)
class EvaluationContext:
    """Per-decision-point snapshot a RuleEvaluator checks a proposed driving
    increment against.

    Distinct from PlanningContext (the static, trip-level snapshot): this
    carries the engine's running clocks at one point in the simulation.
    `cumulative_driving_hours` and `elapsed_duty_window_hours` are tracked
    as separate fields — even though this phase's PlanningEngine only ever
    advances them together (nothing yet consumes on-duty time that isn't
    driving) — because BR-1 (11-hour driving limit) and BR-2 (14-hour duty
    window) are independent clocks that will diverge once non-driving
    activity (breaks, fuel, inspections) is introduced in a later phase.

    `cumulative_driving_hours` is also read by BreakEvaluator (BR-4's
    8-cumulative-hour trigger) — a separate rule, but the same underlying
    running total, since the engine does not yet model a break resetting
    one clock without resetting the other (that distinction only matters
    once break/reset events actually exist).

    `cumulative_distance_miles`/`proposed_distance_miles` exist for
    FuelEvaluator (BR-19's 1,000-mile interval) and default to zero so
    evaluators that don't care about distance (DrivingLimitEvaluator,
    DutyWindowEvaluator, BreakEvaluator) can ignore them entirely.
    """

    cumulative_driving_hours: Decimal
    elapsed_duty_window_hours: Decimal
    proposed_driving_hours: Decimal
    cumulative_distance_miles: Decimal = Decimal('0')
    proposed_distance_miles: Decimal = Decimal('0')

    def __post_init__(self) -> None:
        if self.cumulative_driving_hours < 0:
            raise InvalidEvaluationContextError('cumulative_driving_hours cannot be negative.')
        if self.elapsed_duty_window_hours < 0:
            raise InvalidEvaluationContextError('elapsed_duty_window_hours cannot be negative.')
        if self.proposed_driving_hours < 0:
            raise InvalidEvaluationContextError('proposed_driving_hours cannot be negative.')
        if self.cumulative_distance_miles < 0:
            raise InvalidEvaluationContextError('cumulative_distance_miles cannot be negative.')
        if self.proposed_distance_miles < 0:
            raise InvalidEvaluationContextError('proposed_distance_miles cannot be negative.')


@dataclass(frozen=True)
class RuleResult:
    """Structured outcome of one RuleEvaluator's decision.

    `remaining_driving_hours`/`remaining_duty_window_hours`/
    `remaining_distance_miles` are populated only by the evaluator each
    concerns (the others are left None) — when `allowed` is True, the
    value is the budget remaining *after* consuming the proposed
    increment; when `allowed` is False, it is the budget that was already
    available *before* the (rejected) proposed increment.
    """

    allowed: bool
    evaluator_name: str
    reason: str
    remaining_driving_hours: Decimal | None = None
    remaining_duty_window_hours: Decimal | None = None
    remaining_distance_miles: Decimal | None = None


@dataclass(frozen=True)
class PlanningResult:
    """Successful output of the planning pipeline."""

    context: PlanningContext
    events: tuple[EngineEvent, ...]
    rule_results: tuple[RuleResult, ...] = ()


@dataclass(frozen=True)
class PlanningFailure:
    """Returned instead of PlanningResult when the trip cannot be planned
    (BR-37) — the engine never returns a partial or non-compliant result.
    """

    reason: str
    rule_id: str | None = None
