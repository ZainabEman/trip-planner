"""Abstract interface every FMCSA rule evaluator must implement.

Phase 4C.2 implements the first two concrete rules (DrivingLimitEvaluator,
DutyWindowEvaluator) against this contract. Rules not yet implemented
(30-minute break, fuel interval, 70-hour cycle, 34-hour restart) will
satisfy this same interface when they arrive in a later phase.
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

        See docs/hos-engine-design.md §4 for the intended precedence order
        (70-hour cycle, then 14-hour window, then 8-hour break trigger,
        then 11-hour driving limit, then fuel interval). This phase leaves
        gaps in the numbering (10/20/30/40/50) so the not-yet-implemented
        rules can be inserted at their intended position later without
        renumbering the ones that already exist.
        """
        raise NotImplementedError
