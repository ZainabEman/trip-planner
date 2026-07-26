"""PlanningEngine — the single entry point into the HOS planning pipeline.

Executes the registered RuleEvaluators (in priority order) against each
RouteLeg's driving demand in turn, accumulating cumulative driving hours,
elapsed duty-window hours, cumulative distance, and cumulative cycle
hours as it goes. As soon as any evaluator blocks a leg, the engine stops
processing further legs — no remedy is scheduled *mid-trip* yet, so
halting remains the only correct behavior there.

The one exception, and the only remedy this phase schedules, is the
**pre-flight** 34-hour restart: a driver who arrives with an already
exhausted 70-hour cycle (BR-8) needs a restart before any driving is
attempted, and that restart sits at the trip's start location on the
trip's start time, so it needs neither route-geometry interpolation nor
mid-leg splitting to place. See `_apply_preflight_restart`.

Consequently this is the first phase in which `PlanningResult.events` can
be non-empty, and the first in which EventFactory and TimelineBuilder are
actually used. StateMachine remains unused.

Deliberately still absent (each belongs to the Timeline-generation phase,
not here):

* **Driving / pickup / dropoff / post-trip events.** Nothing on the
  driving path emits an event yet; the leg loop still only collects
  RuleResults.
* **A pre-trip inspection at trip start (BR-21).** The inspection this
  module emits is the one that opens the *post-restart* duty period only
  (see `_apply_preflight_restart`). The always-on BR-21 inspection that
  opens the *first* duty period arrives with the rest of timeline
  generation — its absence here is scope, not an oversight.
* **Mid-trip restarts (EC-20, EC-42) and BR-36's "restart at the last
  legal point".** Both need a leg to be splittable at an arbitrary
  mileage, which `RouteLegInput` cannot yet express (it carries endpoints
  but no geometry).
* **Nearest-binding-constraint selection.** The evaluator loop still
  returns on the first block by priority. That is safe while the only
  remedy acted on is the pre-flight one — which is evaluated before any
  clock but the cycle has advanced, so no other rule can be binding at
  that moment.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from apps.planning.choices import DutyStatus, EventType
from apps.planning.services.hos.constants import CYCLE_RESTART_HOURS, PRETRIP_INSPECTION_HOURS
from apps.planning.services.hos.evaluators.base import RuleEvaluator
from apps.planning.services.hos.event_factory import EventFactory
from apps.planning.services.hos.models import (
    MINUTES_PER_HOUR,
    EvaluationContext,
    PlanningContext,
    PlanningResult,
    RequiredAction,
    RuleResult,
)
from apps.planning.services.hos.timeline_builder import TimelineBuilder


class PlanningEngine:
    """Coordinates registered RuleEvaluators over a Trip's route legs.

    No rule logic lives here — this class only sequences calls to the
    evaluators, in priority order, stops on the first block, and schedules
    the remedy an evaluator asked for via `RuleResult.required_action`.
    Which 70-hour threshold counts as "exhausted" is CycleLimitEvaluator's
    business, not this class's; the engine only recognises the
    `RESTART_34` action that evaluator reports.
    """

    def __init__(self, evaluators: list[RuleEvaluator] | None = None) -> None:
        self._evaluators = sorted(evaluators or [], key=lambda evaluator: evaluator.priority())

    def plan(self, context: PlanningContext) -> PlanningResult:
        current_time = context.trip_start_time
        cumulative_driving_hours = Decimal('0')
        elapsed_duty_window_hours = Decimal('0')
        cumulative_distance_miles = Decimal('0')
        cumulative_cycle_hours = context.cycle_hours_used
        rule_results: list[RuleResult] = []
        timeline = TimelineBuilder()

        preflight = self._apply_preflight_restart(context, timeline, current_time, cumulative_cycle_hours)
        if preflight is not None:
            current_time, cumulative_cycle_hours, elapsed_duty_window_hours, blocking_result = preflight
            rule_results.append(blocking_result)

        for leg in context.route_legs:
            eval_context = EvaluationContext(
                cumulative_driving_hours=cumulative_driving_hours,
                elapsed_duty_window_hours=elapsed_duty_window_hours,
                proposed_driving_hours=leg.duration_hours,
                cumulative_distance_miles=cumulative_distance_miles,
                proposed_distance_miles=leg.distance_miles,
                cumulative_cycle_hours=cumulative_cycle_hours,
            )

            leg_results, blocking_result = self._run_evaluators(eval_context)
            rule_results.extend(leg_results)

            if blocking_result is not None:
                break

            cumulative_driving_hours += leg.duration_hours
            elapsed_duty_window_hours += leg.duration_hours
            cumulative_distance_miles += leg.distance_miles
            # Driving is on-duty time, so it accrues against the cycle (BR-8).
            cumulative_cycle_hours += leg.duration_hours

        return PlanningResult(
            context=context,
            events=tuple(timeline.build()),
            rule_results=tuple(rule_results),
        )

    def _run_evaluators(
        self, eval_context: EvaluationContext
    ) -> tuple[list[RuleResult], RuleResult | None]:
        """Run the registered evaluators in priority order, stopping at the
        first block.

        Returns every result produced plus the blocking one (or None). The
        first-block-wins semantics are unchanged from the previous phase —
        this is only extracted so the pre-flight check and the leg loop
        share one implementation of it rather than two.
        """
        results: list[RuleResult] = []
        for evaluator in self._evaluators:
            result = evaluator.evaluate(eval_context)
            results.append(result)
            if not result.allowed:
                return results, result
        return results, None

    def _apply_preflight_restart(
        self,
        context: PlanningContext,
        timeline: TimelineBuilder,
        current_time: datetime,
        cumulative_cycle_hours: Decimal,
    ) -> tuple[datetime, Decimal, Decimal, RuleResult] | None:
        """Insert a 34-hour restart before any driving if the cycle is
        already exhausted at trip start (BR-8/BR-10, AC-11, EC-4/EC-44).

        Returns the advanced clock, the reset cycle total, the elapsed
        duty-window hours for the newly opened duty period, and the
        RuleResult that triggered the restart — or None if no restart is
        due, which is the overwhelmingly common case.

        The condition is detected by *asking the evaluators*, using a
        zero-hour proposed increment, rather than by restating the 70-hour
        threshold here — that keeps the engine free of rule logic. Only
        CycleLimitEvaluator can block a zero-hour increment (every other
        evaluator allows one, since it consumes no budget), and any block
        that is not a RESTART_34 request is deliberately ignored so this
        guard can never halt a plan the leg loop would otherwise have
        handled.

        **Assumption (approved, and the one this phase makes most
        visible): a 34-hour restart begins a new duty period, and
        therefore emits its own pre-trip inspection.** `hos-engine-design.md`
        records duty-period granularity as the design's most consequential
        open question — BR-21/BR-22 bracket "each duty period" without the
        PRD defining where one ends. This engine resolves it as: any
        qualifying off-duty block of 10 hours or more (so every 10-hour
        reset and every 34-hour restart) closes one duty period and opens
        the next, which gets a fresh 15-minute pre-trip inspection. The
        14-hour window then opens at the *start* of that inspection, not
        at the first driving minute (BR-24).
        """
        probe = EvaluationContext(
            cumulative_driving_hours=Decimal('0'),
            elapsed_duty_window_hours=Decimal('0'),
            proposed_driving_hours=Decimal('0'),
            cumulative_cycle_hours=cumulative_cycle_hours,
        )
        _, blocking_result = self._run_evaluators(probe)

        if blocking_result is None or blocking_result.required_action is not RequiredAction.RESTART_34:
            return None

        # Both events sit at the trip's start location. PlanningContext
        # guarantees at least one leg, and no interpolation is needed
        # because the truck has not moved yet — which is precisely what
        # makes the pre-flight restart placeable without route geometry.
        origin = context.route_legs[0]
        latitude = origin.origin_latitude
        longitude = origin.origin_longitude
        location_name = context.current_location_text

        # Converted to whole minutes so the clock arithmetic stays exact —
        # both durations are exact multiples of a minute by construction.
        restart_end = current_time + timedelta(minutes=int(CYCLE_RESTART_HOURS * MINUTES_PER_HOUR))
        timeline.add_event(
            EventFactory.create_event(
                start_time=current_time,
                end_time=restart_end,
                # Off Duty per A-10's simpler default; sleeper berth is a
                # structurally valid alternative the v1 policy never picks.
                duty_status=DutyStatus.OFF_DUTY,
                event_type=EventType.CYCLE_RESTART_34,
                location_name=location_name,
                latitude=latitude,
                longitude=longitude,
                reason=blocking_result.reason,
            )
        )

        inspection_end = restart_end + timedelta(
            minutes=int(PRETRIP_INSPECTION_HOURS * MINUTES_PER_HOUR)
        )
        timeline.add_event(
            EventFactory.create_event(
                start_time=restart_end,
                end_time=inspection_end,
                duty_status=DutyStatus.ON_DUTY_NOT_DRIVING,
                event_type=EventType.PRETRIP_INSPECTION,
                location_name=location_name,
                latitude=latitude,
                longitude=longitude,
                reason=(
                    'Pre-trip inspection opening the duty period that begins after the '
                    '34-hour cycle restart (BR-21; restart starts a new duty period).'
                ),
            )
        )

        # The restart clears the cycle (BR-10); the inspection that follows
        # is on-duty time, so it immediately accrues against the fresh
        # cycle total (BR-8) and against the duty window it just opened
        # (BR-24).
        return (
            inspection_end,
            PRETRIP_INSPECTION_HOURS,
            PRETRIP_INSPECTION_HOURS,
            blocking_result,
        )
