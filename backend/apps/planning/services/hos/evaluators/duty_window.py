"""BR-2 — the 14-hour duty window.

A driver may not drive after the 14th consecutive hour following the
start of on-duty time (49 CFR 395.3(a)(2)). The window is consecutive
elapsed time and does not pause for non-driving work — but this evaluator
only ever judges a proposed *driving* increment, so BR-3 (non-driving
work may continue past the 14th hour) never needs to be modeled here.

Like DrivingLimitEvaluator, this evaluator never creates TimelineEvents
and never mutates the EvaluationContext it is given.
"""
from __future__ import annotations

from decimal import Decimal

from apps.planning.services.hos.constants import FOURTEEN_HOUR_DUTY_WINDOW
from apps.planning.services.hos.evaluators.base import RuleEvaluator
from apps.planning.services.hos.models import EvaluationContext, RequiredAction, RuleResult

_EVALUATOR_NAME = 'DutyWindowEvaluator'
_RULE_ID = 'BR-2'


class DutyWindowEvaluator(RuleEvaluator):
    """Enforces BR-2: no driving beyond the 14-hour duty window."""

    def priority(self) -> int:
        # See evaluators/base.py: gaps left for cycle (10); driving limit
        # (40) and later rules run after this one, per the design doc's
        # precedence order (cycle -> window -> break -> driving limit -> fuel).
        return 20

    def evaluate(self, context: EvaluationContext) -> RuleResult:
        projected = context.elapsed_duty_window_hours + context.proposed_driving_hours

        if projected > FOURTEEN_HOUR_DUTY_WINDOW:
            return RuleResult(
                allowed=False,
                evaluator_name=_EVALUATOR_NAME,
                reason=(
                    f'Driving {context.proposed_driving_hours}h would bring elapsed duty-window '
                    f'time to {projected}h, exceeding the 14-hour duty window (BR-2).'
                ),
                remaining_duty_window_hours=max(
                    FOURTEEN_HOUR_DUTY_WINDOW - context.elapsed_duty_window_hours, Decimal('0')
                ),
                # Only a 10-hour off-duty reset reopens an expired window (BR-7).
                required_action=RequiredAction.RESET_10,
                rule_id=_RULE_ID,
            )

        return RuleResult(
            allowed=True,
            evaluator_name=_EVALUATOR_NAME,
            reason='Within the 14-hour duty window (BR-2).',
            remaining_duty_window_hours=FOURTEEN_HOUR_DUTY_WINDOW - projected,
            rule_id=_RULE_ID,
        )
