"""BR-19 — the 1,000-mile fuel interval.

A fuel stop must occur before 1,000 miles are driven since the last
fuel stop or trip start (Assumption A-14 / BR-19). This evaluator only
decides whether a proposed driving increment fits inside the remaining
1,000-mile budget before a fuel stop becomes mandatory. Exactly where a
fuel stop should be placed, or whether it can be merged with another
required stop (BR-6, BR-34), is an event-scheduling decision for a later
phase — this evaluator only answers "is fuel due," not "where."

Like the other evaluators, this one never creates TimelineEvents and
never mutates the EvaluationContext it is given.
"""
from __future__ import annotations

from decimal import Decimal

from apps.planning.services.hos.constants import FUEL_INTERVAL_MILES
from apps.planning.services.hos.evaluators.base import RuleEvaluator
from apps.planning.services.hos.models import EvaluationContext, RequiredAction, RuleResult

_EVALUATOR_NAME = 'FuelEvaluator'
_RULE_ID = 'BR-19'


class FuelEvaluator(RuleEvaluator):
    """Enforces BR-19: a fuel stop is required before 1,000 miles are
    driven since the last fuel stop or trip start.
    """

    def priority(self) -> int:
        # See evaluators/base.py: fuel runs last, after the driving limit (40).
        return 50

    def evaluate(self, context: EvaluationContext) -> RuleResult:
        projected = context.cumulative_distance_miles + context.proposed_distance_miles

        if projected > FUEL_INTERVAL_MILES:
            return RuleResult(
                allowed=False,
                evaluator_name=_EVALUATOR_NAME,
                reason=(
                    f'Driving {context.proposed_distance_miles} miles would bring cumulative '
                    f'distance to {projected} miles since the last fuel stop, exceeding the '
                    f'1,000-mile fuel interval (BR-19).'
                ),
                remaining_distance_miles=max(
                    FUEL_INTERVAL_MILES - context.cumulative_distance_miles, Decimal('0')
                ),
                required_action=RequiredAction.FUEL,
                rule_id=_RULE_ID,
            )

        return RuleResult(
            allowed=True,
            evaluator_name=_EVALUATOR_NAME,
            reason='Within the 1,000-mile fuel interval (BR-19).',
            remaining_distance_miles=FUEL_INTERVAL_MILES - projected,
            rule_id=_RULE_ID,
        )
