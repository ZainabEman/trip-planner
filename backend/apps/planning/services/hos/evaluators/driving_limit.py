"""BR-1 — the 11-hour driving limit.

A driver may not drive more than 11 cumulative hours in a duty period
(49 CFR 395.3(a)(3)). This evaluator only decides whether a proposed
driving increment fits inside the remaining 11-hour budget. It never
creates TimelineEvents, never mutates the EvaluationContext it is given,
and knows nothing about any other rule.
"""
from __future__ import annotations

from decimal import Decimal

from apps.planning.services.hos.constants import ELEVEN_HOUR_DRIVING_LIMIT
from apps.planning.services.hos.evaluators.base import RuleEvaluator
from apps.planning.services.hos.models import EvaluationContext, RequiredAction, RuleResult

_EVALUATOR_NAME = 'DrivingLimitEvaluator'
_RULE_ID = 'BR-1'


class DrivingLimitEvaluator(RuleEvaluator):
    """Enforces BR-1: at most 11 cumulative driving hours per duty period."""

    def priority(self) -> int:
        # See evaluators/base.py: gaps left for cycle (10), break (30), fuel (50).
        return 40

    def evaluate(self, context: EvaluationContext) -> RuleResult:
        projected = context.cumulative_driving_hours + context.proposed_driving_hours

        if projected > ELEVEN_HOUR_DRIVING_LIMIT:
            return RuleResult(
                allowed=False,
                evaluator_name=_EVALUATOR_NAME,
                reason=(
                    f'Driving {context.proposed_driving_hours}h would bring cumulative '
                    f'driving to {projected}h, exceeding the 11-hour driving limit (BR-1).'
                ),
                remaining_driving_hours=max(
                    ELEVEN_HOUR_DRIVING_LIMIT - context.cumulative_driving_hours, Decimal('0')
                ),
                # Only 10 consecutive off-duty hours clear the driving clock (BR-7).
                required_action=RequiredAction.RESET_10,
                rule_id=_RULE_ID,
            )

        return RuleResult(
            allowed=True,
            evaluator_name=_EVALUATOR_NAME,
            reason='Within the 11-hour driving limit (BR-1).',
            remaining_driving_hours=ELEVEN_HOUR_DRIVING_LIMIT - projected,
            rule_id=_RULE_ID,
        )
