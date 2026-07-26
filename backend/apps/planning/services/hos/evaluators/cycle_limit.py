"""BR-8 — the 70-hour/8-day cycle limit.

A driver may not drive after accumulating 70 hours of on-duty time in any
period of 8 consecutive days (49 CFR 395.3(b)(2)). Unlike the 11-hour
limit, the cycle counts *all* on-duty time — driving plus inspections,
loading, fuelling and paperwork (BR-8) — which is why this evaluator sums
`proposed_driving_hours + proposed_on_duty_hours` rather than reading the
driving clock alone.

Only a 34-hour restart clears the cycle (BR-10), so a block from this
evaluator always reports `RequiredAction.RESTART_34`. The restart itself
is scheduled by PlanningEngine, not here: a restart never *forbids*
driving, so it cannot be expressed as an allowed/blocked verdict without
duplicating the threshold below. That is the reason there is deliberately
no `34HourRestartEvaluator` — one trigger, one remedy, so an independent
ComplianceValidator has a single threshold to check rather than two that
could drift apart (docs/hos-engine-design.md §3, R-1 mitigation).

BR-11 (the cycle blocks driving only — non-driving work may still
proceed) needs no modelling here for the same reason it doesn't in
DutyWindowEvaluator: this evaluator only ever judges a proposed *driving*
increment.

Like the other evaluators, this one never creates TimelineEvents and
never mutates the EvaluationContext it is given.

Documented simplification — BR-9 (rolling 8-day drop-out)
--------------------------------------------------------
BR-9 says the oldest day's on-duty hours drop out of the rolling total as
each new day is added. That is **not implemented, and cannot be** from
the input this engine is given: the driver's cycle history arrives as the
single scalar `Trip.cycle_hours_used` (PRD FR-1.5, 0–70), which says how
many hours were used but not *when*. Recovering a per-day distribution
from one total is impossible, so there is no day whose hours could be
identified and dropped.

The consequence is that `cumulative_cycle_hours` only ever grows within a
trip, never decays. That is the **conservative** direction — the engine
may schedule a 34-hour restart slightly earlier than a driver with a
known-favourable 8-day history would strictly need, but it will never
permit driving the real rolling window would forbid. Since BR-37/NFR-2.4
require the engine never emit a non-compliant plan, erring toward an
extra restart is the correct failure mode.

Lifting this would mean accepting a per-day on-duty history as engine
input instead of a scalar, which is a PRD-level input-model change (a new
field on Trip and a new form input), not an engine change. Recorded here
and in docs/hos-engine-design.md as a supported v1 simplification.
"""
from __future__ import annotations

from decimal import Decimal

from apps.planning.services.hos.constants import SEVENTY_HOUR_CYCLE_LIMIT
from apps.planning.services.hos.evaluators.base import RuleEvaluator
from apps.planning.services.hos.models import EvaluationContext, RequiredAction, RuleResult

_EVALUATOR_NAME = 'CycleLimitEvaluator'
_RULE_ID = 'BR-8'


class CycleLimitEvaluator(RuleEvaluator):
    """Enforces BR-8: at most 70 on-duty hours in a rolling 8-day cycle."""

    def priority(self) -> int:
        # See evaluators/base.py: the cycle is the broadest clock and runs
        # first, at the slot the original numbering reserved for it
        # (cycle -> window -> break -> driving limit -> fuel).
        return 10

    def evaluate(self, context: EvaluationContext) -> RuleResult:
        # The cycle counts every on-duty hour, not just driving (BR-8).
        projected = (
            context.cumulative_cycle_hours
            + context.proposed_driving_hours
            + context.proposed_on_duty_hours
        )
        remaining_before = max(
            SEVENTY_HOUR_CYCLE_LIMIT - context.cumulative_cycle_hours, Decimal('0')
        )

        # Two distinct blocking conditions. The second is the familiar
        # "this increment would breach the limit" check every other
        # evaluator makes. The first is specific to the cycle: a driver
        # who has *already* reached 70 hours may not drive at all, so the
        # block must fire even for a zero-length proposed increment. That
        # is what lets PlanningEngine detect an exhausted cycle before any
        # driving is attempted (BR-10, AC-11, EC-4/EC-44) by evaluating a
        # zero-hour increment, without the engine having to restate the
        # 70-hour threshold itself.
        #
        # It is a deliberate divergence from the other evaluators, which
        # all allow a zero-length increment unconditionally: for them a
        # zero increment consumes no budget and so cannot breach anything,
        # whereas here the budget is already gone.
        if context.cumulative_cycle_hours >= SEVENTY_HOUR_CYCLE_LIMIT:
            return RuleResult(
                allowed=False,
                evaluator_name=_EVALUATOR_NAME,
                reason=(
                    f'Cycle hours used ({context.cumulative_cycle_hours}h) has reached the '
                    f'70-hour/8-day limit; no driving is permitted until a 34-hour restart '
                    f'is completed (BR-8, BR-10).'
                ),
                remaining_cycle_hours=remaining_before,
                required_action=RequiredAction.RESTART_34,
                rule_id=_RULE_ID,
            )

        if projected > SEVENTY_HOUR_CYCLE_LIMIT:
            return RuleResult(
                allowed=False,
                evaluator_name=_EVALUATOR_NAME,
                reason=(
                    f'Driving {context.proposed_driving_hours}h would bring cumulative '
                    f'on-duty time to {projected}h, exceeding the 70-hour/8-day cycle '
                    f'limit (BR-8). Only a 34-hour restart clears the cycle (BR-10).'
                ),
                remaining_cycle_hours=remaining_before,
                required_action=RequiredAction.RESTART_34,
                rule_id=_RULE_ID,
            )

        return RuleResult(
            allowed=True,
            evaluator_name=_EVALUATOR_NAME,
            reason='Within the 70-hour/8-day cycle limit (BR-8).',
            remaining_cycle_hours=SEVENTY_HOUR_CYCLE_LIMIT - projected,
            rule_id=_RULE_ID,
        )
