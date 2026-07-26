"""Unit tests for Phase 4C.2 — DrivingLimitEvaluator, DutyWindowEvaluator,
and PlanningEngine's evaluator-driven per-leg pipeline.

Covers: driving-limit boundary behavior, duty-window boundary behavior,
combined (both rules interacting through PlanningEngine and, where the
current drive-only engine cannot yet construct a scenario, through a
directly hand-built EvaluationContext), and edge cases (zero-length leg,
fractional durations, empty route, a single very long leg).
"""
import uuid
from datetime import datetime, timezone as dt_timezone
from decimal import Decimal

from django.test import SimpleTestCase

from apps.planning.services.hos.engine import PlanningEngine
from apps.planning.services.hos.evaluators.driving_limit import DrivingLimitEvaluator
from apps.planning.services.hos.evaluators.duty_window import DutyWindowEvaluator
from apps.planning.services.hos.exceptions import InvalidEvaluationContextError, InvalidPlanningContextError
from apps.planning.services.hos.models import EvaluationContext, PlanningContext, RouteLegInput

START = datetime(2026, 7, 27, 8, 0, tzinfo=dt_timezone.utc)


def make_route_leg(sequence: int, duration_minutes: int) -> RouteLegInput:
    return RouteLegInput(
        sequence=sequence,
        origin_text=f'Origin {sequence}',
        destination_text=f'Destination {sequence}',
        origin_latitude=32.0,
        origin_longitude=-96.0,
        destination_latitude=33.0,
        destination_longitude=-97.0,
        distance_miles=Decimal('50.00'),
        duration_minutes=duration_minutes,
    )


def make_context(*leg_durations_minutes: int, cycle_hours_used: Decimal = Decimal('0')) -> PlanningContext:
    legs = tuple(
        make_route_leg(sequence=i + 1, duration_minutes=minutes)
        for i, minutes in enumerate(leg_durations_minutes)
    )
    return PlanningContext(
        trip_id=uuid.uuid4(),
        current_location_text='Dallas, TX',
        pickup_location_text='Fort Worth, TX',
        dropoff_location_text='Chicago, IL',
        trip_start_time=START,
        cycle_hours_used=cycle_hours_used,
        route_legs=legs,
    )


def eval_context(cumulative: str, elapsed: str, proposed: str) -> EvaluationContext:
    return EvaluationContext(
        cumulative_driving_hours=Decimal(cumulative),
        elapsed_duty_window_hours=Decimal(elapsed),
        proposed_driving_hours=Decimal(proposed),
    )


class DrivingLimitEvaluatorTests(SimpleTestCase):
    def setUp(self):
        self.evaluator = DrivingLimitEvaluator()

    def test_exactly_eleven_hours_is_allowed(self):
        result = self.evaluator.evaluate(eval_context('0', '0', '11.0'))
        self.assertTrue(result.allowed)
        self.assertEqual(result.remaining_driving_hours, Decimal('0.0'))

    def test_less_than_eleven_hours_is_allowed(self):
        result = self.evaluator.evaluate(eval_context('0', '0', '5'))
        self.assertTrue(result.allowed)
        self.assertEqual(result.remaining_driving_hours, Decimal('6'))

    def test_greater_than_eleven_hours_is_blocked(self):
        result = self.evaluator.evaluate(eval_context('0', '0', '11.5'))
        self.assertFalse(result.allowed)
        self.assertIn('11-hour driving limit', result.reason)

    def test_multiple_legs_accumulating_to_exactly_eleven_hours(self):
        # First leg consumes 5h, leaving 6h; a second 6h leg lands exactly on the limit.
        first = self.evaluator.evaluate(eval_context('0', '0', '5'))
        self.assertTrue(first.allowed)

        second = self.evaluator.evaluate(eval_context('5', '5', '6'))
        self.assertTrue(second.allowed)
        self.assertEqual(second.remaining_driving_hours, Decimal('0'))

    def test_accumulation_that_exceeds_eleven_hours_is_blocked(self):
        result = self.evaluator.evaluate(eval_context('8', '8', '4'))
        self.assertFalse(result.allowed)
        # 3h of budget remained before this (rejected) 4h proposal.
        self.assertEqual(result.remaining_driving_hours, Decimal('3'))

    def test_result_names_the_evaluator(self):
        result = self.evaluator.evaluate(eval_context('0', '0', '1'))
        self.assertEqual(result.evaluator_name, 'DrivingLimitEvaluator')

    def test_priority(self):
        self.assertEqual(self.evaluator.priority(), 40)


class DutyWindowEvaluatorTests(SimpleTestCase):
    def setUp(self):
        self.evaluator = DutyWindowEvaluator()

    def test_exactly_fourteen_hours_is_allowed(self):
        result = self.evaluator.evaluate(eval_context('0', '0', '14.0'))
        self.assertTrue(result.allowed)
        self.assertEqual(result.remaining_duty_window_hours, Decimal('0.0'))

    def test_less_than_fourteen_hours_is_allowed(self):
        result = self.evaluator.evaluate(eval_context('0', '0', '10'))
        self.assertTrue(result.allowed)
        self.assertEqual(result.remaining_duty_window_hours, Decimal('4'))

    def test_greater_than_fourteen_hours_is_blocked(self):
        result = self.evaluator.evaluate(eval_context('0', '0', '14.5'))
        self.assertFalse(result.allowed)
        self.assertIn('14-hour duty window', result.reason)

    def test_multi_leg_accumulation_landing_exactly_on_the_window(self):
        first = self.evaluator.evaluate(eval_context('0', '0', '10'))
        self.assertTrue(first.allowed)

        second = self.evaluator.evaluate(eval_context('10', '10', '4'))
        self.assertTrue(second.allowed)
        self.assertEqual(second.remaining_duty_window_hours, Decimal('0'))

    def test_multi_leg_accumulation_that_exceeds_the_window_is_blocked(self):
        result = self.evaluator.evaluate(eval_context('10', '10', '5'))
        self.assertFalse(result.allowed)
        self.assertEqual(result.remaining_duty_window_hours, Decimal('4'))

    def test_priority(self):
        self.assertEqual(self.evaluator.priority(), 20)


class CombinedEvaluatorTests(SimpleTestCase):
    """Tests exercising both evaluators together — either through
    PlanningEngine's per-leg loop, or via a directly hand-built
    EvaluationContext where the current drive-only engine cannot yet
    reach the scenario being tested.
    """

    def test_both_rules_satisfied(self):
        engine = PlanningEngine(evaluators=[DrivingLimitEvaluator(), DutyWindowEvaluator()])
        context = make_context(5 * 60, 2 * 60)  # 5h + 2h = 7h total

        result = engine.plan(context)

        self.assertTrue(all(r.allowed for r in result.rule_results))
        self.assertEqual(len(result.rule_results), 4)  # 2 legs x 2 evaluators

    def test_driving_limit_reached_before_duty_window(self):
        # Two 6h legs: at leg 2, cumulative driving hits 12h (>11, blocked)
        # while elapsed duty-window time is only 12h (<14, would still allow).
        engine = PlanningEngine(evaluators=[DrivingLimitEvaluator(), DutyWindowEvaluator()])
        context = make_context(6 * 60, 6 * 60)

        result = engine.plan(context)

        # Leg 1: window allowed, limit allowed. Leg 2: window allowed, limit blocked -> stop.
        self.assertEqual(len(result.rule_results), 4)
        self.assertTrue(result.rule_results[0].allowed)
        self.assertTrue(result.rule_results[1].allowed)
        self.assertTrue(result.rule_results[2].allowed)
        self.assertFalse(result.rule_results[3].allowed)
        self.assertEqual(result.rule_results[3].evaluator_name, 'DrivingLimitEvaluator')

    def test_duty_window_reached_before_driving_limit(self):
        # Not reachable end-to-end yet with only driving legs (both clocks
        # advance together in this phase's engine), but the two rules must
        # already behave independently for when non-driving time exists in
        # a later phase. cumulative_driving=5h (well under 11h) while
        # elapsed_duty_window=14h already (at the boundary) + a 1h proposal.
        context = eval_context('5', '14', '1')

        window_result = DutyWindowEvaluator().evaluate(context)
        limit_result = DrivingLimitEvaluator().evaluate(context)

        self.assertFalse(window_result.allowed)
        self.assertTrue(limit_result.allowed)

    def test_engine_stops_processing_after_a_block_and_does_not_evaluate_further_legs(self):
        engine = PlanningEngine(evaluators=[DrivingLimitEvaluator(), DutyWindowEvaluator()])
        # Leg 1 alone already exceeds the driving limit; a 3rd leg exists
        # but must never be reached.
        context = make_context(12 * 60, 5 * 60, 5 * 60)

        result = engine.plan(context)

        # Only leg 1 evaluated: window (allowed, 12<14) then limit (blocked, 12>11).
        self.assertEqual(len(result.rule_results), 2)
        self.assertTrue(result.rule_results[0].allowed)
        self.assertFalse(result.rule_results[1].allowed)


class EdgeCaseTests(SimpleTestCase):
    def test_zero_length_leg_is_allowed_by_both_evaluators(self):
        context = eval_context('0', '0', '0')

        self.assertTrue(DrivingLimitEvaluator().evaluate(context).allowed)
        self.assertTrue(DutyWindowEvaluator().evaluate(context).allowed)

    def test_zero_length_leg_via_engine_does_not_advance_or_block(self):
        engine = PlanningEngine(evaluators=[DrivingLimitEvaluator(), DutyWindowEvaluator()])
        context = make_context(0, 5 * 60)

        result = engine.plan(context)

        self.assertTrue(all(r.allowed for r in result.rule_results))
        self.assertEqual(len(result.rule_results), 4)

    def test_fractional_duration_is_handled_precisely(self):
        # 90 minutes = 1.5 hours exactly.
        leg = make_route_leg(sequence=1, duration_minutes=90)
        self.assertEqual(leg.duration_hours, Decimal('1.5'))

        result = DrivingLimitEvaluator().evaluate(eval_context('10', '10', str(leg.duration_hours)))
        self.assertFalse(result.allowed)  # 10 + 1.5 = 11.5 > 11

    def test_empty_route_is_rejected_at_context_construction(self):
        with self.assertRaises(InvalidPlanningContextError):
            PlanningContext(
                trip_id=uuid.uuid4(),
                current_location_text='Dallas, TX',
                pickup_location_text='Fort Worth, TX',
                dropoff_location_text='Chicago, IL',
                trip_start_time=START,
                cycle_hours_used=Decimal('0'),
                route_legs=(),
            )

    def test_single_very_long_leg_exceeding_driving_limit_but_not_window(self):
        # 12h: under the 14h window, over the 11h driving limit.
        engine = PlanningEngine(evaluators=[DrivingLimitEvaluator(), DutyWindowEvaluator()])
        context = make_context(12 * 60)

        result = engine.plan(context)

        self.assertEqual(len(result.rule_results), 2)
        self.assertTrue(result.rule_results[0].allowed)  # DutyWindowEvaluator: 12 < 14
        self.assertFalse(result.rule_results[1].allowed)  # DrivingLimitEvaluator: 12 > 11

    def test_single_very_long_leg_exceeding_both_limits_stops_at_the_first_priority_check(self):
        # 20h exceeds both the 11h driving limit and the 14h window. Since
        # DutyWindowEvaluator has higher priority (runs first) and blocks
        # immediately, DrivingLimitEvaluator must never even be invoked.
        engine = PlanningEngine(evaluators=[DrivingLimitEvaluator(), DutyWindowEvaluator()])
        context = make_context(20 * 60)

        result = engine.plan(context)

        self.assertEqual(len(result.rule_results), 1)
        self.assertEqual(result.rule_results[0].evaluator_name, 'DutyWindowEvaluator')
        self.assertFalse(result.rule_results[0].allowed)

    def test_negative_hours_rejected_by_evaluation_context(self):
        with self.assertRaises(InvalidEvaluationContextError):
            eval_context('-1', '0', '1')
