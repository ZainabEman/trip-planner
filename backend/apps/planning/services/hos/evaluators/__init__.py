"""The active FMCSA rule set.

`default_evaluators()` is the one place that decides *which* rules a plan is
checked against. PlanningEngine deliberately takes its evaluators as a
constructor argument (so tests can register any subset), which means
something has to name the production set — this is that something, rather
than a list hardcoded inside a caller.

Order is irrelevant here: PlanningEngine sorts by `priority()`.
"""
from __future__ import annotations

from apps.planning.services.hos.evaluators.base import RuleEvaluator
from apps.planning.services.hos.evaluators.break_rule import BreakEvaluator
from apps.planning.services.hos.evaluators.cycle_limit import CycleLimitEvaluator
from apps.planning.services.hos.evaluators.driving_limit import DrivingLimitEvaluator
from apps.planning.services.hos.evaluators.duty_window import DutyWindowEvaluator
from apps.planning.services.hos.evaluators.fuel_rule import FuelEvaluator

__all__ = [
    'BreakEvaluator',
    'CycleLimitEvaluator',
    'DrivingLimitEvaluator',
    'DutyWindowEvaluator',
    'FuelEvaluator',
    'RuleEvaluator',
    'default_evaluators',
]


def default_evaluators() -> list[RuleEvaluator]:
    """Every rule evaluator implemented to date, as a fresh list.

    Returned as a new list per call because PlanningEngine sorts what it is
    given; handing out a shared module-level list would let one engine's
    construction reorder another's.
    """
    return [
        CycleLimitEvaluator(),
        DutyWindowEvaluator(),
        BreakEvaluator(),
        DrivingLimitEvaluator(),
        FuelEvaluator(),
    ]
