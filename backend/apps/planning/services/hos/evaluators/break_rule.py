"""BR-4 — the 30-minute break requirement.

Driving is not permitted after 8 cumulative hours of driving without an
intervening qualifying break of at least 30 consecutive minutes (49 CFR
395.3(a)(3)(ii)). The 8 hours are cumulative, not consecutive (BR-4).

The break itself may be Off Duty, Sleeper Berth, or On Duty (Not
Driving) (BR-5), and an already-required non-driving stop of at least
30 minutes can satisfy it instead of a standalone break (BR-6/BR-34) —
but which duty status the break takes, and whether it gets merged with
another stop, are RemedyEngine's decisions, not this evaluator's. This
evaluator only decides whether a proposed driving increment fits inside
the remaining 8-hour budget before a break becomes mandatory.

Like the other evaluators, this one never creates TimelineEvents and
never mutates the EvaluationContext it is given.
"""
from __future__ import annotations

from decimal import Decimal

from apps.planning.services.hos.constants import EIGHT_HOUR_BREAK_TRIGGER
from apps.planning.services.hos.evaluators.base import RuleEvaluator
from apps.planning.services.hos.models import EvaluationContext, RequiredAction, RuleResult

_EVALUATOR_NAME = 'BreakEvaluator'
_RULE_ID = 'BR-4'


class BreakEvaluator(RuleEvaluator):
    """Enforces BR-4: a 30-minute break is required before 8 cumulative
    driving hours elapse without one.
    """

    def priority(self) -> int:
        # See evaluators/base.py: runs after the duty window (20) and
        # before the driving limit (40), per the design doc's precedence
        # order (cycle -> window -> break -> driving limit -> fuel).
        return 30

    def evaluate(self, context: EvaluationContext) -> RuleResult:
        # BR-4 counts driving hours *since the last qualifying break*, which
        # stops being the same number as BR-1's per-duty-period total the
        # moment a break is actually taken. Callers that predate breaks leave
        # `driving_hours_since_break` unset and get the old reading — see
        # EvaluationContext for why that fallback is `None` and not zero.
        cumulative = (
            context.cumulative_driving_hours
            if context.driving_hours_since_break is None
            else context.driving_hours_since_break
        )
        projected = cumulative + context.proposed_driving_hours

        if projected > EIGHT_HOUR_BREAK_TRIGGER:
            return RuleResult(
                allowed=False,
                evaluator_name=_EVALUATOR_NAME,
                reason=(
                    f'Driving {context.proposed_driving_hours}h would bring cumulative '
                    f'driving to {projected}h without an intervening 30-minute break, '
                    f'exceeding the 8-cumulative-hour break trigger (BR-4).'
                ),
                remaining_driving_hours=max(
                    EIGHT_HOUR_BREAK_TRIGGER - cumulative, Decimal('0')
                ),
                required_action=RequiredAction.BREAK_30,
                rule_id=_RULE_ID,
            )

        return RuleResult(
            allowed=True,
            evaluator_name=_EVALUATOR_NAME,
            reason='Within the 8-cumulative-hour break trigger (BR-4).',
            remaining_driving_hours=EIGHT_HOUR_BREAK_TRIGGER - projected,
            rule_id=_RULE_ID,
        )
