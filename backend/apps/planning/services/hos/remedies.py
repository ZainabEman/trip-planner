"""RemedyEngine — the other half of "one trigger, one remedy".

An evaluator detects that driving may not continue and names the remedy that
would make it legal again (`RuleResult.required_action`). This module owns
everything about that remedy: how long it lasts, what duty status it is taken
in, which timeline event represents it, and which clocks it clears. No
evaluator knows any of that, and none of it is restated in PlanningEngine.

The separation is what an independent ComplianceValidator needs. If
BreakEvaluator also decided that a break is thirty minutes long, the trigger
and the remedy could drift apart and a validator sharing the evaluator would
never notice (docs/hos-engine-design.md §3, R-1 mitigation). Here the trigger
lives in `constants.EIGHT_HOUR_BREAK_TRIGGER`, the remedy in
`constants.THIRTY_MINUTE_BREAK_HOURS`, and neither module reads the other's.

The dispatch table below is exhaustive over `RequiredAction`: every action an
evaluator can name has exactly one entry, and `RequiredAction.NONE` has none by
design. An action with no entry means "no legal remedy exists", which is the
one condition that now genuinely fails a plan.

What each remedy clears is the part worth reading carefully, because a remedy
that clears one clock too many produces a plan that looks legal and is not:

    remedy        duration  duty status  driving  window  cycle  break  fuel
    ------------  --------  -----------  -------  ------  -----  -----  ----
    30-min break     0.5 h  off duty        no      no     no    yes     no
    10-hr reset       10 h  off duty       yes     yes     no    yes     no
    34-hr restart     34 h  off duty       yes     yes    yes    yes     no
    fuel stop        0.5 h  on duty         no      no     no    yes*   yes

    * BR-6/BR-34: a required non-driving stop of at least thirty minutes
      satisfies the break requirement rather than being served alongside a
      separate one. See constants.FUEL_STOP_HOURS.

Note that no remedy clears the fuel interval except fuelling, and no rest
clears it either — BR-19 counts miles driven, and parking does not un-drive
them.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal

from apps.planning.choices import DutyStatus, EventType
from apps.planning.services.hos.constants import (
    CYCLE_RESTART_HOURS,
    FUEL_STOP_HOURS,
    TEN_HOUR_RESET_HOURS,
    THIRTY_MINUTE_BREAK_HOURS,
)
from apps.planning.services.hos.cursor import PlannerAction, PlanningCursor
from apps.planning.services.hos.event_factory import EventFactory
from apps.planning.services.hos.models import MINUTES_PER_HOUR, RequiredAction


@dataclass(frozen=True)
class Remedy:
    """One legal way to make driving permissible again.

    Pure policy: a description of the remedy, holding no logic. `RemedyEngine`
    reads it to emit the event and move the clocks.
    """

    action: PlannerAction
    event_type: EventType
    duty_status: DutyStatus
    hours: Decimal
    label: str
    #: Off-duty rest passes time without accruing duty or cycle hours; an
    #: on-duty stop such as fuelling accrues both (BR-8 counts all on-duty
    #: time, not just driving).
    counts_as_on_duty: bool
    #: A qualifying block of ten hours or more closes one duty period and opens
    #: the next, which gets its own pre-trip inspection (Assumption 2,
    #: docs/hos-engine-design.md). PlanningEngine emits that inspection —
    #: opening a duty period is not itself a remedy.
    opens_new_duty_period: bool
    clears_cycle: bool
    satisfies_break: bool
    refuels: bool


REMEDIES: dict[RequiredAction, Remedy] = {
    RequiredAction.BREAK_30: Remedy(
        action=PlannerAction.BREAK,
        event_type=EventType.REST_BREAK_30,
        # BR-5 permits off duty, sleeper berth, or on duty not driving. Off
        # duty is A-10's simpler default and the cheapest of the three for the
        # driver, since it accrues no cycle time.
        duty_status=DutyStatus.OFF_DUTY,
        hours=THIRTY_MINUTE_BREAK_HOURS,
        label='30-minute break',
        counts_as_on_duty=False,
        opens_new_duty_period=False,
        clears_cycle=False,
        satisfies_break=True,
        refuels=False,
    ),
    RequiredAction.RESET_10: Remedy(
        action=PlannerAction.OFF_DUTY,
        event_type=EventType.DAILY_REST_10,
        duty_status=DutyStatus.OFF_DUTY,
        hours=TEN_HOUR_RESET_HOURS,
        label='10-hour off-duty reset',
        counts_as_on_duty=False,
        opens_new_duty_period=True,
        # A reset does not touch the 70-hour cycle. Only a 34-hour restart
        # does (BR-10) — which is why a long enough trip eventually needs one
        # even though it takes a reset every day.
        clears_cycle=False,
        satisfies_break=True,
        refuels=False,
    ),
    RequiredAction.RESTART_34: Remedy(
        action=PlannerAction.CYCLE_RESTART,
        event_type=EventType.CYCLE_RESTART_34,
        duty_status=DutyStatus.OFF_DUTY,
        hours=CYCLE_RESTART_HOURS,
        label='34-hour cycle restart',
        counts_as_on_duty=False,
        opens_new_duty_period=True,
        clears_cycle=True,
        satisfies_break=True,
        refuels=False,
    ),
    RequiredAction.FUEL: Remedy(
        action=PlannerAction.FUEL,
        event_type=EventType.FUEL,
        # Fuelling is work, not rest (BR-14), so unlike the other three this
        # one accrues duty-window and cycle hours while it happens.
        duty_status=DutyStatus.ON_DUTY_NOT_DRIVING,
        hours=FUEL_STOP_HOURS,
        label='fuel stop',
        counts_as_on_duty=True,
        opens_new_duty_period=False,
        clears_cycle=False,
        # BR-6/BR-34: thirty on-duty non-driving minutes is a qualifying break.
        satisfies_break=True,
        refuels=True,
    ),
}


@dataclass(frozen=True)
class RemedyOutcome:
    """What applying a remedy did, for the caller to react to."""

    remedy: Remedy
    opened_new_duty_period: bool


def remedy_for(required_action: RequiredAction) -> Remedy | None:
    """The one legal remedy for an action, or None if there is not one.

    None is the answer for `RequiredAction.NONE` and for any action added to
    the enum without a matching entry here — in both cases PlanningEngine stops
    rather than inventing something.
    """
    return REMEDIES.get(required_action)


class RemedyEngine:
    """Applies a named remedy to a cursor: emits its event, moves its clocks.

    Stateless. Every fact it needs is on the `Remedy` it is given, so adding a
    remedy means adding a table entry, not a branch.
    """

    def apply(
        self,
        cursor: PlanningCursor,
        remedy: Remedy,
        *,
        location_name: str,
        latitude: float,
        longitude: float,
        reason: str,
    ) -> RemedyOutcome:
        start = cursor.current_time
        end = start + timedelta(minutes=int(remedy.hours * MINUTES_PER_HOUR))

        cursor.timeline.add_event(
            EventFactory.create_event(
                start_time=start,
                end_time=end,
                duty_status=remedy.duty_status,
                event_type=remedy.event_type,
                location_name=location_name,
                latitude=latitude,
                longitude=longitude,
                reason=reason,
            )
        )

        cursor.advance(
            remedy.action, remedy.hours, counts_as_on_duty=remedy.counts_as_on_duty
        )

        # Order matters only in that the clock effects follow the advance: a
        # remedy clears the clock it is the remedy *for*, and the time it takes
        # must be on the books before the clock it does not clear is read again.
        if remedy.clears_cycle:
            cursor.reset_cycle()
        if remedy.opens_new_duty_period:
            cursor.open_new_duty_period()
        if remedy.satisfies_break:
            cursor.take_break()
        if remedy.refuels:
            cursor.refuel()

        cursor.last_remedy_action = remedy.action.value
        cursor.drove_since_last_remedy = False

        return RemedyOutcome(remedy=remedy, opened_new_duty_period=remedy.opens_new_duty_period)
