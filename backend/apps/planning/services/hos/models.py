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

import enum
import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    # Import-time cycle: cursor.py needs this module's DTOs, so its own types
    # are referenced here only for annotations. `from __future__ import
    # annotations` above makes every annotation a string, so nothing is
    # evaluated at runtime.
    from apps.planning.services.hos.cursor import PlanningDay, PlanningPause

from apps.planning.choices import DutyStatus, EventType
from apps.planning.services.hos.exceptions import (
    InvalidEvaluationContextError,
    InvalidPlanningContextError,
)

MINUTES_PER_HOUR = Decimal('60')


class RequiredAction(enum.Enum):
    """What the engine must schedule to clear a blocking RuleResult.

    A blocked RuleResult says *that* driving may not continue; this says
    *what would make it legal again*. Without it the engine can only tell
    one kind of block from another by string-matching `evaluator_name`,
    which is why every block previously halted the plan outright.

    This is the mechanism that keeps the remedy for a rule out of the
    rule's own evaluator: BR-8's 70-hour limit is checked by
    CycleLimitEvaluator, which reports RESTART_34, and the 34-hour restart
    itself is scheduled by PlanningEngine. There is deliberately no
    "34HourRestartEvaluator" — a restart never forbids driving, so it
    cannot be expressed as a RuleEvaluator's allowed/blocked verdict
    without duplicating CycleLimitEvaluator's threshold (see
    docs/hos-engine-design.md §3, RuleResult).

    Only RESTART_34 is acted on by the engine today. The remaining members
    are the actions the four existing evaluators already imply, named here
    so those evaluators can report them now and the engine can learn to
    schedule them without the vocabulary changing underneath it.
    """

    NONE = 'none'
    BREAK_30 = 'break_30'
    RESET_10 = 'reset_10'
    RESTART_34 = 'restart_34'
    FUEL = 'fuel'


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


# DutyTransition used to live here. It now lives in state_machine.py
# alongside the DutyState enum whose values it records and the StateMachine
# that produces it: this module imported DutyState to type its two fields
# while state_machine.py imported DutyTransition back to construct it,
# forming an import cycle that only a function-local import kept from
# failing at startup. Moving the dataclass to its sole producer makes the
# dependency one-directional (state_machine no longer imports this module
# at all) and removes the deferred import.


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

    `cumulative_cycle_hours`/`proposed_on_duty_hours` exist for
    CycleLimitEvaluator (BR-8's 70-hour/8-day limit) and default to zero
    on the same principle. They are a separate pair from the driving
    clocks above because the cycle counts *all* on-duty time, not just
    driving (BR-8) — so a proposed increment contributes
    `proposed_driving_hours + proposed_on_duty_hours` to the cycle, but
    only `proposed_driving_hours` to the 11-hour limit. Nothing populates
    `proposed_on_duty_hours` with a non-zero value yet (the engine emits
    no on-duty non-driving events on the driving path), but modelling it
    now is what stops CycleLimitEvaluator from silently encoding
    "cycle == driving time", which is wrong and hard to spot later.
    """

    cumulative_driving_hours: Decimal
    elapsed_duty_window_hours: Decimal
    proposed_driving_hours: Decimal
    cumulative_distance_miles: Decimal = Decimal('0')
    proposed_distance_miles: Decimal = Decimal('0')
    cumulative_cycle_hours: Decimal = Decimal('0')
    proposed_on_duty_hours: Decimal = Decimal('0')

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
        if self.cumulative_cycle_hours < 0:
            raise InvalidEvaluationContextError('cumulative_cycle_hours cannot be negative.')
        if self.proposed_on_duty_hours < 0:
            raise InvalidEvaluationContextError('proposed_on_duty_hours cannot be negative.')


@dataclass(frozen=True)
class RuleResult:
    """Structured outcome of one RuleEvaluator's decision.

    `remaining_driving_hours`/`remaining_duty_window_hours`/
    `remaining_distance_miles`/`remaining_cycle_hours` are populated only
    by the evaluator each concerns (the others are left None) — when
    `allowed` is True, the value is the budget remaining *after* consuming
    the proposed increment; when `allowed` is False, it is the budget that
    was already available *before* the (rejected) proposed increment.

    `required_action` names the remedy that would make driving legal again
    (see RequiredAction); `rule_id` names the business rule that produced
    the verdict (e.g. 'BR-8'), giving each emitted event's `reason` a
    traceable origin per FR-4.2/BR-33/US-22. Both default to a neutral
    value so every existing construction of this DTO stays valid.
    """

    allowed: bool
    evaluator_name: str
    reason: str
    remaining_driving_hours: Decimal | None = None
    remaining_duty_window_hours: Decimal | None = None
    remaining_distance_miles: Decimal | None = None
    remaining_cycle_hours: Decimal | None = None
    required_action: RequiredAction = RequiredAction.NONE
    rule_id: str | None = None


@dataclass(frozen=True)
class PlanningResult:
    """Successful output of the planning pipeline.

    `days` and `pause` are additive and default to empty, so every existing
    construction and every caller that reads only `events`/`rule_results`
    keeps working unchanged:

    * `days` groups the finished timeline by calendar date. A trip no longer
      has to fit in one duty period, so the result has to be able to describe
      more than one day.
    * `pause` is set instead of `days` when planning stopped short: it records
      which rule blocked, where on the leg the truck ran out of clock, and how
      much of the leg is left. Nothing consumes it yet — it is what Phase 12B's
      remedy insertion resumes from.

    Note that `events` is still empty whenever `pause` is set. The engine does
    not emit a partial timeline (BR-37/NFR-2.4); the pause is metadata about
    the stop, not a half-finished plan.
    """

    context: PlanningContext
    events: tuple[EngineEvent, ...]
    rule_results: tuple[RuleResult, ...] = ()
    days: tuple['PlanningDay', ...] = ()
    pause: 'PlanningPause | None' = None


@dataclass(frozen=True)
class PlanningFailure:
    """Returned instead of PlanningResult when the trip cannot be planned
    (BR-37) — the engine never returns a partial or non-compliant result.
    """

    reason: str
    rule_id: str | None = None
