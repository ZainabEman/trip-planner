"""The planner's working state: actions, clocks, and the cursor that carries them.

Before this module the engine tracked its progress in local variables inside one
function, which forced two structural assumptions:

* the whole trip fits in a single duty period, because nothing modelled a day
  boundary or a duty period ending; and
* a leg is atomic, because there was nowhere to record "we got this far".

Both are wrong for real freight. This module replaces those locals with an
explicit, mutable `PlanningCursor` that survives the whole run, so the engine
becomes a loop over actions against a cursor rather than a single pass over legs.

Three rules hold here:

1. **The cursor is the only mutable planning state.** The engine reads and
   advances it; it never keeps a parallel copy in a local.
2. **`advance()` is the only clock.** Every event moves time and the duty clocks
   through that one method, so no caller — and no evaluator — can move one clock
   without the others.
3. **Nothing here knows an FMCSA threshold.** The cursor records hours; the
   evaluators decide what a legal number is.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal

from apps.planning.services.hos.models import MINUTES_PER_HOUR, EngineEvent, RuleResult
from apps.planning.services.hos.timeline_builder import TimelineBuilder


class PlannerAction(enum.Enum):
    """What the planner is doing at a point in the schedule.

    Named states rather than booleans: the engine previously distinguished
    "is this the last leg" with an `is_final` flag, which does not extend to
    the breaks and resets Phase 12B adds. An enum does.

    `BREAK`, `FUEL` and `OFF_DUTY` are declared but not yet scheduled — they are
    the actions 12B will push onto the queue when a remedy is required. Naming
    them now fixes the vocabulary the remedy work will use.
    """

    PRETRIP = 'pretrip'
    DRIVING = 'driving'
    BREAK = 'break'
    FUEL = 'fuel'
    PICKUP = 'pickup'
    DROPOFF = 'dropoff'
    OFF_DUTY = 'off_duty'
    CYCLE_RESTART = 'cycle_restart'
    POSTTRIP = 'posttrip'


@dataclass
class DutyClocks:
    """Every clock the rules care about, moved together.

    Kept as one object rather than five loose Decimals so that advancing time
    without advancing the cycle — the bug class that produces a plan that looks
    legal and is not — requires deliberately writing a field, not merely
    forgetting one.
    """

    driving_hours: Decimal = Decimal('0')
    duty_window_hours: Decimal = Decimal('0')
    cycle_hours: Decimal = Decimal('0')
    distance_miles: Decimal = Decimal('0')
    elapsed_hours: Decimal = Decimal('0')

    def snapshot(self) -> 'DutyClocks':
        """A detached copy, for recording state at a point in time."""
        return DutyClocks(
            driving_hours=self.driving_hours,
            duty_window_hours=self.duty_window_hours,
            cycle_hours=self.cycle_hours,
            distance_miles=self.distance_miles,
            elapsed_hours=self.elapsed_hours,
        )


@dataclass(frozen=True)
class PlanningPause:
    """Where planning stopped, and what it would take to continue.

    This is the record Phase 12B consumes. Today the engine still returns no
    events when it pauses — the behaviour is unchanged — but it now knows
    *where* on the leg it ran out of clock and how much of the leg remains,
    which is exactly what inserting a remedy and resuming needs.

    `drivable_hours`/`drivable_miles` are how far the truck could legally have
    gone before the binding limit; `remaining_*` is what would be left of the
    leg afterwards. Both are derived from the blocking `RuleResult`'s own
    remaining-budget field, so the engine still holds no threshold of its own.
    """

    leg_sequence: int
    rule_id: str | None
    evaluator_name: str
    required_action: str
    reason: str
    paused_at: datetime
    drivable_hours: Decimal | None
    drivable_miles: Decimal | None
    remaining_duration_minutes: int
    remaining_distance_miles: Decimal
    clocks: DutyClocks


@dataclass
class PlanningDay:
    """One calendar day of the schedule.

    The engine can now span several. Days are derived from the finished
    timeline rather than tracked as the plan is built, because an event may
    cross midnight and belongs to both days it touches — a decision better made
    once, over the complete list, than incrementally.
    """

    day_number: int
    calendar_date: date
    events: tuple[EngineEvent, ...]

    @property
    def event_count(self) -> int:
        return len(self.events)


class PlanningCursor:
    """The planner's position in space, time and duty hours.

    Mutable by design: it is threaded through one loop and advanced in place.
    Every field an evaluator or a future remedy needs is on it.
    """

    def __init__(self, trip_start_time: datetime, cycle_hours_used: Decimal, leg_count: int) -> None:
        self.trip_start_time = trip_start_time
        self.current_time = trip_start_time

        # Position: which leg, and how far into it. `distance_into_leg_miles`
        # stays zero while legs are atomic, and becomes meaningful the moment
        # 12B resumes a partially driven leg.
        self.leg_index = 0
        self.leg_count = leg_count
        self.distance_into_leg_miles = Decimal('0')

        self.clocks = DutyClocks(cycle_hours=cycle_hours_used)

        self.timeline = TimelineBuilder()
        self.rule_results: list[RuleResult] = []
        self.completed_actions: list[PlannerAction] = []
        self.pause: PlanningPause | None = None

    # ------------------------------------------------------------------
    # Position
    # ------------------------------------------------------------------

    @property
    def destination_reached(self) -> bool:
        """True once every leg has been consumed."""
        return self.leg_index >= self.leg_count

    @property
    def is_final_leg(self) -> bool:
        return self.leg_index == self.leg_count - 1

    @property
    def paused(self) -> bool:
        return self.pause is not None

    def complete_leg(self) -> None:
        self.leg_index += 1
        self.distance_into_leg_miles = Decimal('0')

    # ------------------------------------------------------------------
    # The clock engine — the single place time moves
    # ------------------------------------------------------------------

    def advance(
        self,
        action: PlannerAction,
        hours: Decimal,
        *,
        distance_miles: Decimal = Decimal('0'),
        counts_as_driving: bool = False,
        counts_as_on_duty: bool = True,
    ) -> datetime:
        """Move the clock forward for one completed action.

        Returns the new current time. Durations are converted to whole minutes
        so the arithmetic stays exact — every duration in `constants.py` is a
        whole number of minutes by construction, and going via `timedelta`
        seconds would let float in.

        `counts_as_on_duty=False` is how an off-duty block (a reset or a
        restart) passes time without accruing duty or cycle hours.
        """
        minutes = int(hours * MINUTES_PER_HOUR)
        self.current_time += timedelta(minutes=minutes)
        self.clocks.elapsed_hours += hours

        if counts_as_driving:
            self.clocks.driving_hours += hours
        if counts_as_on_duty:
            # The 14-hour window and the 70-hour cycle both count all on-duty
            # time, driving included (BR-2/BR-24, BR-8).
            self.clocks.duty_window_hours += hours
            self.clocks.cycle_hours += hours

        self.clocks.distance_miles += distance_miles
        self.completed_actions.append(action)
        return self.current_time

    def advance_minutes(
        self,
        action: PlannerAction,
        minutes: int,
        *,
        distance_miles: Decimal = Decimal('0'),
        counts_as_driving: bool = False,
        counts_as_on_duty: bool = True,
    ) -> datetime:
        """`advance` for a duration already expressed in whole minutes.

        Driving durations arrive from the routing provider as integer minutes,
        so converting them to hours and back would round-trip through Decimal
        for no reason.
        """
        return self.advance(
            action,
            Decimal(minutes) / MINUTES_PER_HOUR,
            distance_miles=distance_miles,
            counts_as_driving=counts_as_driving,
            counts_as_on_duty=counts_as_on_duty,
        )

    def open_new_duty_period(self) -> None:
        """Reset the clocks a qualifying off-duty block clears.

        Not called yet — the pre-flight restart resets its clocks through the
        engine today. It exists so 12B's 10-hour reset and mid-trip restart have
        one definition of "a new duty period starts here" rather than two.
        """
        self.clocks.driving_hours = Decimal('0')
        self.clocks.duty_window_hours = Decimal('0')

    def reset_cycle(self) -> None:
        """Clear the 70-hour cycle, as a 34-hour restart does (BR-10)."""
        self.clocks.cycle_hours = Decimal('0')

    # ------------------------------------------------------------------
    # Pausing
    # ------------------------------------------------------------------

    def record_pause(
        self,
        *,
        leg_sequence: int,
        blocking: RuleResult,
        leg_duration_minutes: int,
        leg_distance_miles: Decimal,
    ) -> PlanningPause:
        """Record where planning stopped and how much of the leg is left.

        The drivable budget comes from whichever `remaining_*` field the
        blocking evaluator populated — each populates only its own. Converting
        an hours budget to miles uses the leg's own average speed, which is the
        only speed information available: `RouteLegInput` carries a distance and
        a duration, not a profile.

        A `None` drivable figure means the blocking rule reported no budget in a
        unit that can be converted (or reported none at all), in which case the
        whole leg remains — never a guess.
        """
        drivable_hours: Decimal | None = None
        drivable_miles: Decimal | None = None

        hours_budget = (
            blocking.remaining_driving_hours
            if blocking.remaining_driving_hours is not None
            else blocking.remaining_duty_window_hours
            if blocking.remaining_duty_window_hours is not None
            else blocking.remaining_cycle_hours
        )

        if hours_budget is not None:
            drivable_hours = hours_budget
            if leg_duration_minutes > 0:
                mph = leg_distance_miles / (Decimal(leg_duration_minutes) / MINUTES_PER_HOUR)
                drivable_miles = drivable_hours * mph
        elif blocking.remaining_distance_miles is not None:
            drivable_miles = blocking.remaining_distance_miles
            if leg_distance_miles > 0:
                hours_for_leg = Decimal(leg_duration_minutes) / MINUTES_PER_HOUR
                drivable_hours = drivable_miles / leg_distance_miles * hours_for_leg

        remaining_miles = leg_distance_miles
        remaining_minutes = leg_duration_minutes
        if drivable_miles is not None:
            remaining_miles = max(leg_distance_miles - drivable_miles, Decimal('0'))
        if drivable_hours is not None:
            consumed = int(drivable_hours * MINUTES_PER_HOUR)
            remaining_minutes = max(leg_duration_minutes - consumed, 0)

        self.pause = PlanningPause(
            leg_sequence=leg_sequence,
            rule_id=blocking.rule_id,
            evaluator_name=blocking.evaluator_name,
            required_action=blocking.required_action.value,
            reason=blocking.reason,
            paused_at=self.current_time,
            drivable_hours=drivable_hours,
            drivable_miles=drivable_miles,
            remaining_duration_minutes=remaining_minutes,
            remaining_distance_miles=remaining_miles,
            clocks=self.clocks.snapshot(),
        )
        return self.pause


def group_into_days(events: tuple[EngineEvent, ...]) -> tuple[PlanningDay, ...]:
    """Split a finished timeline into calendar days.

    An event spanning midnight appears in both days it touches, which is what a
    per-day log needs. The events themselves are not sliced — the engine emits
    one continuous event and slicing for display is the reporting layer's job
    (docs/hos-engine-design.md, EC-27).
    """
    by_date: dict[date, list[EngineEvent]] = {}

    for event in events:
        current = event.start_time.date()
        last = event.end_time.date()
        while current <= last:
            by_date.setdefault(current, []).append(event)
            current += timedelta(days=1)

    return tuple(
        PlanningDay(day_number=index + 1, calendar_date=day, events=tuple(day_events))
        for index, (day, day_events) in enumerate(sorted(by_date.items()))
    )
