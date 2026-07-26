"""Abstract interface every FMCSA rule evaluator must implement.

Five concrete rules now satisfy this contract: the 70-hour/8-day cycle
(CycleLimitEvaluator), the 14-hour duty window (DutyWindowEvaluator), the
30-minute break trigger (BreakEvaluator), the 11-hour driving limit
(DrivingLimitEvaluator), and the 1,000-mile fuel interval (FuelEvaluator).

Note what is *not* on this list: the 34-hour restart. A restart never
forbids driving — it is the remedy for a cycle-limit block — so it cannot
be expressed as this interface's allowed/blocked verdict. Evaluators name
the remedy they need via `RuleResult.required_action` and PlanningEngine
schedules it; there is deliberately no `34HourRestartEvaluator`. The same
holds for the 30-minute break, 10-hour reset and fuel stop.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from apps.planning.services.hos.models import EvaluationContext, RuleResult


class RuleEvaluator(ABC):
    """One independently-testable FMCSA rule check.

    An evaluator never creates TimelineEvents and never mutates anything
    itself — it only inspects an EvaluationContext and returns a RuleResult
    describing whether the proposed driving increment is allowed.
    """

    @abstractmethod
    def evaluate(self, context: EvaluationContext) -> RuleResult:
        """Evaluate this rule against a proposed driving increment.

        Returns a RuleResult describing whether the increment is allowed
        and, if not, why — never raises for an ordinary rule violation.
        """
        raise NotImplementedError

    @abstractmethod
    def priority(self) -> int:
        """Lower numbers are evaluated first.

        See docs/hos-engine-design.md §4 for the precedence order: 70-hour
        cycle (10), 14-hour window (20), 8-hour break trigger (30),
        11-hour driving limit (40), fuel interval (50). The numbering is
        spaced by ten so a future rule can be inserted at its intended
        position without renumbering the ones that already exist.

        PlanningEngine currently returns on the *first* evaluator to
        block, so priority doubles as short-circuit order. That is safe
        while the only remedy the engine schedules is the pre-flight
        restart (nothing else has advanced when it runs), but it is not a
        general answer: the first rule to block by priority is not
        necessarily the one that binds soonest. Selecting the
        nearest-binding constraint, which demotes priority to a
        tie-breaker, is deferred with the rest of timeline generation.
        """
        raise NotImplementedError
