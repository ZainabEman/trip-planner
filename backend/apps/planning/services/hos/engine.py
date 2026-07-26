"""PlanningEngine — the single entry point into the HOS planning pipeline.

Executes the registered RuleEvaluators (in priority order) against each
RouteLeg's driving demand in turn, accumulating cumulative driving hours,
elapsed duty-window hours, and cumulative distance as it goes. As soon as
any evaluator blocks a leg, the engine stops processing further legs —
with only four rules implemented (11-hour driving limit, 14-hour duty
window, 30-minute break trigger, 1,000-mile fuel interval) and no
reset/restart modeled yet, there is nothing that could legally resume
driving after a block, so halting is the only correct behavior at this
stage.

Still no TimelineEvent creation: this phase collects RuleResults only.
StateMachine/TimelineBuilder/EventFactory are unused here for now — they
return once event creation is implemented in a later phase.
"""
from __future__ import annotations

from decimal import Decimal

from apps.planning.services.hos.evaluators.base import RuleEvaluator
from apps.planning.services.hos.models import EvaluationContext, PlanningContext, PlanningResult, RuleResult


class PlanningEngine:
    """Coordinates registered RuleEvaluators over a Trip's route legs.

    No rule logic lives here — this class only sequences calls to the
    evaluators, in priority order, and stops on the first block.
    """

    def __init__(self, evaluators: list[RuleEvaluator] | None = None) -> None:
        self._evaluators = sorted(evaluators or [], key=lambda evaluator: evaluator.priority())

    def plan(self, context: PlanningContext) -> PlanningResult:
        cumulative_driving_hours = Decimal('0')
        elapsed_duty_window_hours = Decimal('0')
        cumulative_distance_miles = Decimal('0')
        rule_results: list[RuleResult] = []

        for leg in context.route_legs:
            eval_context = EvaluationContext(
                cumulative_driving_hours=cumulative_driving_hours,
                elapsed_duty_window_hours=elapsed_duty_window_hours,
                proposed_driving_hours=leg.duration_hours,
                cumulative_distance_miles=cumulative_distance_miles,
                proposed_distance_miles=leg.distance_miles,
            )

            blocked = False
            for evaluator in self._evaluators:
                result = evaluator.evaluate(eval_context)
                rule_results.append(result)
                if not result.allowed:
                    blocked = True
                    break

            if blocked:
                break

            cumulative_driving_hours += leg.duration_hours
            elapsed_duty_window_hours += leg.duration_hours
            cumulative_distance_miles += leg.distance_miles

        return PlanningResult(context=context, events=(), rule_results=tuple(rule_results))
