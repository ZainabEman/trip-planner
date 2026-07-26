"""Abstract interface every future FMCSA rule evaluator must implement.

No concrete rule logic exists yet — this phase only defines the contract
concrete evaluators (11-hour driving limit, 14-hour window, 30-minute
break, 70-hour cycle, 34-hour restart, fuel interval, etc.) will satisfy
once they are implemented in a later phase.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from apps.planning.services.hos.models import PlanningContext


class RuleEvaluator(ABC):
    """One independently-testable FMCSA rule check.

    A concrete evaluator will likely need more than the static
    PlanningContext (e.g. the current simulation state and a proposed
    driving increment) — the richer per-step context type is intentionally
    left undefined until the first concrete rule is implemented.
    """

    @abstractmethod
    def evaluate(self, context: PlanningContext) -> Any:
        """Evaluate this rule against the current planning context/state.

        Concrete evaluators will return a RuleResult (introduced alongside
        the first concrete rule) describing whether the proposed action is
        allowed and, if not, what must happen instead and why.
        """
        raise NotImplementedError

    @abstractmethod
    def priority(self) -> int:
        """Lower numbers are evaluated first.

        See docs/hos-engine-design.md §4 for the intended precedence order
        (70-hour cycle, then 14-hour window, then 8-hour break trigger,
        then 11-hour driving limit, then fuel interval).
        """
        raise NotImplementedError
