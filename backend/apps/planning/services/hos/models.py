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
from apps.planning.services.hos.exceptions import InvalidPlanningContextError
from apps.planning.services.hos.state_machine import DutyState


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
class PlanningResult:
    """Successful output of the planning pipeline."""

    context: PlanningContext
    events: tuple[EngineEvent, ...]


@dataclass(frozen=True)
class PlanningFailure:
    """Returned instead of PlanningResult when the trip cannot be planned
    (BR-37) — the engine never returns a partial or non-compliant result.
    """

    reason: str
    rule_id: str | None = None
