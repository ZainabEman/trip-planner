"""PlanningEngine — the single entry point into the HOS planning pipeline.

Phase 4C.1 foundation: this wires the pipeline's components together —
StateMachine, the registered RuleEvaluators, and TimelineBuilder — but
implements no FMCSA rule logic itself. With zero evaluators registered
(none exist yet), `plan()` produces an empty timeline rather than a real
trip plan; concrete rules arrive in a later phase and will populate the
simulation loop this class coordinates.
"""
from __future__ import annotations

from apps.planning.services.hos.evaluators.base import RuleEvaluator
from apps.planning.services.hos.models import PlanningContext, PlanningResult
from apps.planning.services.hos.state_machine import DutyState, StateMachine
from apps.planning.services.hos.timeline_builder import TimelineBuilder


class PlanningEngine:
    """Coordinates StateMachine, registered RuleEvaluators, and TimelineBuilder.

    No rule logic lives here — this class only sequences calls to the
    other components in priority order.
    """

    def __init__(self, evaluators: list[RuleEvaluator] | None = None) -> None:
        self._evaluators = sorted(evaluators or [], key=lambda evaluator: evaluator.priority())

    def plan(self, context: PlanningContext) -> PlanningResult:
        # A fresh StateMachine per planning run — state is never shared
        # across calls. Not yet threaded into the loop below; reserved for
        # the simulation loop a later phase's evaluators will drive.
        _state_machine = StateMachine(
            initial_state=DutyState.OFF_DUTY,
            initialized_at=context.trip_start_time,
        )
        timeline_builder = TimelineBuilder()

        # No evaluators are registered in this foundation phase, so there is
        # nothing yet to populate timeline_builder with. The pipeline below
        # is wired end-to-end so it is exercised by this phase's tests;
        # concrete RuleEvaluator implementations (a later phase) will emit
        # real events into timeline_builder here.
        for evaluator in self._evaluators:
            evaluator.evaluate(context)

        events = tuple(timeline_builder.build())
        return PlanningResult(context=context, events=events)
