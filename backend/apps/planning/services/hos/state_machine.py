"""The HOS engine's internal duty-state machine — states only, no FMCSA rule logic.

DutyState tracks which "mode" the planning simulation is currently in
(driving, on a break, refueling, etc.) purely as engine bookkeeping. It
is deliberately distinct from the persisted `apps.planning.choices`
vocabulary (`DutyStatus`/`EventType`) that TimelineEvent rows are stored
with — that is the caller-facing/persisted vocabulary; this is the
engine's own internal simulation-control concept.

No rule about *when* a transition is allowed (e.g. "driving requires 10
consecutive hours off duty first") is implemented here. StateMachine only
records whatever transition it is given and keeps a chronological
history — which transitions *should* happen is a future RuleEvaluator's
responsibility.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass
from datetime import datetime

from apps.planning.services.hos.exceptions import InvalidStateTransitionError


class DutyState(enum.Enum):
    """The engine's internal simulation states."""

    OFF_DUTY = 'off_duty'
    ON_DUTY = 'on_duty'
    DRIVING = 'driving'
    BREAK = 'break'
    FUEL_STOP = 'fuel_stop'
    INSPECTION = 'inspection'


@dataclass(frozen=True)
class DutyTransition:
    """A record of the engine's internal state machine moving from one
    DutyState to another.

    Lives here rather than in models.py (where it was originally defined)
    because StateMachine below is its only producer and DutyState above is
    its only field type — keeping all three together means state_machine.py
    imports nothing from models.py, which is what removes the import cycle
    the two modules previously had.
    """

    from_state: DutyState
    to_state: DutyState
    occurred_at: datetime
    reason: str = ''


class StateMachine:
    """Tracks the engine's current DutyState and its transition history.

    Deliberately permissive: any transition it is given is recorded
    unconditionally, aside from a basic chronological sanity check.
    """

    def __init__(
        self,
        initial_state: DutyState = DutyState.OFF_DUTY,
        initialized_at: datetime | None = None,
    ) -> None:
        self._current_state = initial_state
        self._last_transition_at = initialized_at
        self._history: list[DutyTransition] = []

    @property
    def current_state(self) -> DutyState:
        return self._current_state

    @property
    def history(self) -> tuple[DutyTransition, ...]:
        return tuple(self._history)

    def transition_to(
        self, new_state: DutyState, occurred_at: datetime, reason: str = ''
    ) -> DutyTransition:
        if self._last_transition_at is not None and occurred_at < self._last_transition_at:
            raise InvalidStateTransitionError(
                f'Transition at {occurred_at} occurs before the previous '
                f'transition at {self._last_transition_at}.'
            )

        transition = DutyTransition(
            from_state=self._current_state,
            to_state=new_state,
            occurred_at=occurred_at,
            reason=reason,
        )
        self._current_state = new_state
        self._last_transition_at = occurred_at
        self._history.append(transition)
        return transition
