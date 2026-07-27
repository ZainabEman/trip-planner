"""Phase 12A — planning cursor, clock engine, multi-day grouping and pausing.

These cover the scheduler's new internal structure. The behavioural guarantees
(which events an ordinary trip produces, which rule blocks an illegal one) are
covered by the existing suites and are deliberately unchanged by this phase —
what is new here is that the engine can now *describe* a multi-day plan and say
where it stopped, rather than only succeeding or failing.
"""
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

from django.test import SimpleTestCase

from apps.planning.choices import DutyStatus, EventType
from apps.planning.services.hos.cursor import (
    DutyClocks,
    PlannerAction,
    PlanningCursor,
    group_into_days,
)
from apps.planning.services.hos.engine import PlanningEngine
from apps.planning.services.hos.evaluators import default_evaluators
from apps.planning.services.hos.evaluators.base import RuleEvaluator
from apps.planning.services.hos.event_factory import EventFactory
from apps.planning.services.hos.models import (
    EvaluationContext,
    PlanningContext,
    RequiredAction,
    RouteLegInput,
    RuleResult,
)

START = datetime(2026, 8, 1, 8, 0, tzinfo=dt_timezone.utc)


class UnremediableEvaluator(RuleEvaluator):
    """A rule that forbids all driving and names no remedy.

    Since remedies were introduced, essentially every real trip is plannable —
    a long enough one just takes more days — so an evaluator like this is the
    only way to reach the engine's give-up path deliberately. It is also the
    honest test of the contract: the engine fails when, and only when, no legal
    continuation exists.
    """

    def priority(self) -> int:
        return 99

    def evaluate(self, context: EvaluationContext) -> RuleResult:
        if context.proposed_driving_hours <= 0:
            # Must allow the zero-hour pre-flight probe, or it would be
            # mistaken for an exhausted cycle.
            return RuleResult(allowed=True, evaluator_name='UnremediableEvaluator', reason='ok')
        return RuleResult(
            allowed=False,
            evaluator_name='UnremediableEvaluator',
            reason='Driving is forbidden and nothing can make it legal.',
            required_action=RequiredAction.NONE,
            rule_id='BR-TEST',
        )


def make_leg(sequence: int, duration_minutes: int, distance_miles: str) -> RouteLegInput:
    return RouteLegInput(
        sequence=sequence,
        origin_text=f'Origin {sequence}',
        destination_text=f'Destination {sequence}',
        origin_latitude=32.0,
        origin_longitude=-96.0,
        destination_latitude=33.0,
        destination_longitude=-97.0,
        distance_miles=Decimal(distance_miles),
        duration_minutes=duration_minutes,
    )


def make_context(*legs: RouteLegInput, cycle_hours_used: str = '0') -> PlanningContext:
    return PlanningContext(
        trip_id=uuid.uuid4(),
        current_location_text='Dallas, TX',
        pickup_location_text='Fort Worth, TX',
        dropoff_location_text='Houston, TX',
        trip_start_time=START,
        cycle_hours_used=Decimal(cycle_hours_used),
        route_legs=legs or (make_leg(1, 46, '35.90'), make_leg(2, 255, '262.00')),
    )


def plan(*legs: RouteLegInput, cycle_hours_used: str = '0'):
    engine = PlanningEngine(evaluators=default_evaluators())
    return engine.plan(make_context(*legs, cycle_hours_used=cycle_hours_used))


class ClockEngineTests(SimpleTestCase):
    """`PlanningCursor.advance` is the only thing that moves time."""

    def cursor(self, cycle: str = '0') -> PlanningCursor:
        return PlanningCursor(START, Decimal(cycle), leg_count=2)

    def test_on_duty_action_advances_every_clock_together(self):
        cursor = self.cursor()
        cursor.advance(PlannerAction.PRETRIP, Decimal('0.25'))

        self.assertEqual(cursor.current_time, START + timedelta(minutes=15))
        self.assertEqual(cursor.clocks.duty_window_hours, Decimal('0.25'))
        self.assertEqual(cursor.clocks.cycle_hours, Decimal('0.25'))
        self.assertEqual(cursor.clocks.elapsed_hours, Decimal('0.25'))
        # An inspection is on duty but not driving.
        self.assertEqual(cursor.clocks.driving_hours, Decimal('0'))

    def test_driving_also_advances_the_driving_clock_and_distance(self):
        cursor = self.cursor()
        cursor.advance_minutes(
            PlannerAction.DRIVING, 120, distance_miles=Decimal('100'), counts_as_driving=True
        )

        self.assertEqual(cursor.clocks.driving_hours, Decimal('2'))
        self.assertEqual(cursor.clocks.duty_window_hours, Decimal('2'))
        self.assertEqual(cursor.clocks.cycle_hours, Decimal('2'))
        self.assertEqual(cursor.clocks.distance_miles, Decimal('100'))

    def test_off_duty_passes_time_without_accruing_cycle_hours(self):
        cursor = self.cursor('40')
        cursor.advance(PlannerAction.CYCLE_RESTART, Decimal('34'), counts_as_on_duty=False)

        self.assertEqual(cursor.current_time, START + timedelta(hours=34))
        self.assertEqual(cursor.clocks.elapsed_hours, Decimal('34'))
        # The cycle carries the hours it arrived with; the restart clears it
        # separately, which is a different operation.
        self.assertEqual(cursor.clocks.cycle_hours, Decimal('40'))

    def test_off_duty_still_spends_the_fourteen_hour_window(self):
        # BR-2/BR-24: the window is 14 *consecutive* hours and does not pause
        # for rest. A short break spends it while giving nothing back — which
        # is the whole reason a break is not a substitute for a reset. Only
        # open_new_duty_period clears it.
        cursor = self.cursor()
        cursor.advance(PlannerAction.BREAK, Decimal('0.5'), counts_as_on_duty=False)

        self.assertEqual(cursor.clocks.duty_window_hours, Decimal('0.5'))
        self.assertEqual(cursor.clocks.cycle_hours, Decimal('0'))

        cursor.open_new_duty_period()
        self.assertEqual(cursor.clocks.duty_window_hours, Decimal('0'))

    def test_a_break_clears_only_the_break_trigger(self):
        # The narrowest of the four remedies, and the one whose scope matters
        # most: widening it is the easiest way to emit an illegal plan.
        cursor = self.cursor()
        cursor.advance_minutes(PlannerAction.DRIVING, 8 * 60, counts_as_driving=True)

        cursor.take_break()

        self.assertEqual(cursor.clocks.driving_since_break_hours, Decimal('0'))
        # BR-1's eleven hours and BR-2's fourteen are untouched by a break.
        self.assertEqual(cursor.clocks.driving_hours, Decimal('8'))
        self.assertEqual(cursor.clocks.duty_window_hours, Decimal('8'))
        self.assertEqual(cursor.clocks.cycle_hours, Decimal('8'))

    def test_refuelling_clears_only_the_fuel_interval(self):
        cursor = self.cursor()
        cursor.advance_minutes(
            PlannerAction.DRIVING, 60, distance_miles=Decimal('900'), counts_as_driving=True
        )

        cursor.refuel()

        self.assertEqual(cursor.clocks.distance_since_fuel_miles, Decimal('0'))
        # The trip total is a different number and keeps accumulating.
        self.assertEqual(cursor.clocks.distance_miles, Decimal('900'))

    def test_reset_cycle_and_new_duty_period_clear_their_own_clocks(self):
        cursor = self.cursor('70')
        cursor.advance_minutes(PlannerAction.DRIVING, 60, counts_as_driving=True)

        cursor.reset_cycle()
        cursor.open_new_duty_period()

        self.assertEqual(cursor.clocks.cycle_hours, Decimal('0'))
        self.assertEqual(cursor.clocks.driving_hours, Decimal('0'))
        self.assertEqual(cursor.clocks.duty_window_hours, Decimal('0'))
        # Elapsed trip time is never rewound — the hours still happened.
        self.assertEqual(cursor.clocks.elapsed_hours, Decimal('1'))

    def test_every_advance_records_its_action(self):
        cursor = self.cursor()
        cursor.advance(PlannerAction.PRETRIP, Decimal('0.25'))
        cursor.advance_minutes(PlannerAction.DRIVING, 60, counts_as_driving=True)
        cursor.advance(PlannerAction.PICKUP, Decimal('1'))

        self.assertEqual(
            cursor.completed_actions,
            [PlannerAction.PRETRIP, PlannerAction.DRIVING, PlannerAction.PICKUP],
        )

    def test_clock_snapshot_detaches_from_further_movement(self):
        cursor = self.cursor()
        cursor.advance(PlannerAction.PRETRIP, Decimal('0.25'))
        snapshot = cursor.clocks.snapshot()
        cursor.advance_minutes(PlannerAction.DRIVING, 60, counts_as_driving=True)

        self.assertEqual(snapshot.duty_window_hours, Decimal('0.25'))
        self.assertEqual(cursor.clocks.duty_window_hours, Decimal('1.25'))


class CursorPositionTests(SimpleTestCase):
    def test_cursor_starts_at_the_first_leg(self):
        cursor = PlanningCursor(START, Decimal('0'), leg_count=2)

        self.assertEqual(cursor.leg_index, 0)
        self.assertFalse(cursor.destination_reached)
        self.assertFalse(cursor.is_final_leg)
        self.assertFalse(cursor.paused)

    def test_completing_every_leg_reaches_the_destination(self):
        cursor = PlanningCursor(START, Decimal('0'), leg_count=2)

        cursor.complete_leg()
        self.assertTrue(cursor.is_final_leg)
        cursor.complete_leg()
        self.assertTrue(cursor.destination_reached)

    def test_completing_a_leg_clears_the_partial_position(self):
        cursor = PlanningCursor(START, Decimal('0'), leg_count=2)
        cursor.distance_into_leg_miles = Decimal('120')

        cursor.complete_leg()

        self.assertEqual(cursor.distance_into_leg_miles, Decimal('0'))


class PlanningDayTests(SimpleTestCase):
    """The engine no longer assumes a trip fits in one day."""

    def test_a_short_trip_is_a_single_day(self):
        result = plan()

        self.assertEqual(len(result.days), 1)
        self.assertEqual(result.days[0].day_number, 1)
        self.assertEqual(result.days[0].event_count, len(result.events))

    def test_a_restart_trip_spans_several_days(self):
        # 34 hours off duty plus the run pushes this well past one calendar day.
        result = plan(cycle_hours_used='70')

        self.assertGreater(len(result.days), 1)
        self.assertEqual([day.day_number for day in result.days], list(range(1, len(result.days) + 1)))
        # Days come back in calendar order.
        dates = [day.calendar_date for day in result.days]
        self.assertEqual(dates, sorted(dates))

    def test_an_event_crossing_midnight_appears_in_both_days(self):
        # A 34-hour restart necessarily straddles at least one midnight.
        result = plan(cycle_hours_used='70')
        restart = next(e for e in result.events if e.event_type == EventType.CYCLE_RESTART_34)

        containing = [day for day in result.days if restart in day.events]

        self.assertGreaterEqual(len(containing), 2)

    def test_grouping_is_pure_and_handles_an_empty_timeline(self):
        self.assertEqual(group_into_days(()), ())

    def test_grouping_places_each_event_on_its_own_date(self):
        first = EventFactory.create_event(
            start_time=START,
            end_time=START + timedelta(hours=1),
            duty_status=DutyStatus.DRIVING,
            event_type=EventType.DRIVE,
            location_name='A',
            latitude=0.0,
            longitude=0.0,
            reason='r',
        )
        next_day = EventFactory.create_event(
            start_time=START + timedelta(days=1),
            end_time=START + timedelta(days=1, hours=1),
            duty_status=DutyStatus.DRIVING,
            event_type=EventType.DRIVE,
            location_name='B',
            latitude=0.0,
            longitude=0.0,
            reason='r',
        )

        days = group_into_days((first, next_day))

        self.assertEqual(len(days), 2)
        self.assertEqual(days[0].event_count, 1)
        self.assertEqual(days[1].event_count, 1)


class PlanningPauseTests(SimpleTestCase):
    """A pause is now a dead end, not an ordinary block.

    The 20-hour leg these tests were written against in Phase 12A no longer
    pauses at all — it is scheduled across two days (see RemedyTests). Reaching
    a pause requires a rule that names no remedy, which is what
    `UnremediableEvaluator` supplies.
    """

    def blocked(self, *legs: RouteLegInput):
        engine = PlanningEngine(evaluators=[*default_evaluators(), UnremediableEvaluator()])
        return engine.plan(make_context(*legs))

    def test_a_trip_with_no_legal_continuation_returns_no_events(self):
        result = self.blocked()

        # Unchanged behaviour: no partial timeline is emitted (BR-37, FR-4.5),
        # even though the engine got as far as the pre-trip inspection.
        self.assertEqual(result.events, ())
        self.assertEqual(result.days, ())

    def test_the_pause_names_the_leg_and_the_blocking_rule(self):
        pause = self.blocked().pause

        self.assertIsNotNone(pause)
        self.assertEqual(pause.leg_sequence, 1)
        self.assertEqual(pause.rule_id, 'BR-TEST')
        self.assertEqual(pause.evaluator_name, 'UnremediableEvaluator')
        self.assertEqual(pause.required_action, 'none')

    def test_the_pause_captures_the_clocks_and_the_moment(self):
        pause = self.blocked().pause

        # Paused at the first driving decision, immediately after the pre-trip
        # inspection that opened the duty period.
        self.assertEqual(pause.clocks.duty_window_hours, pause.clocks.cycle_hours)
        self.assertEqual(pause.paused_at, START + timedelta(minutes=15))

    def test_a_successful_plan_records_no_pause(self):
        self.assertIsNone(plan().pause)

    def test_a_successful_multi_day_plan_records_no_pause(self):
        # The case that used to pause. A rule blocking is now routine.
        result = plan(make_leg(1, 46, '35.90'), make_leg(2, 20 * 60, '1100.00'))

        self.assertIsNone(result.pause)
        self.assertTrue(any(not rule.allowed for rule in result.rule_results))

    def test_planning_stops_at_the_first_dead_end(self):
        # Leg 1 has no legal continuation, so leg 2 is never reached.
        result = self.blocked(make_leg(1, 60, '50.00'), make_leg(2, 60, '50.00'))

        self.assertEqual(result.pause.leg_sequence, 1)


class RegressionTests(SimpleTestCase):
    """The refactor must not have changed what an ordinary trip produces."""

    def test_short_trip_event_sequence_is_unchanged(self):
        result = plan()

        self.assertEqual(
            [event.event_type for event in result.events],
            [
                EventType.PRETRIP_INSPECTION,
                EventType.DRIVE,
                EventType.PICKUP,
                EventType.DRIVE,
                EventType.DROPOFF,
                EventType.POSTTRIP_INSPECTION,
            ],
        )

    def test_short_trip_timeline_is_still_contiguous(self):
        events = plan().events

        self.assertEqual(events[0].start_time, START)
        for previous, current in zip(events, events[1:]):
            self.assertEqual(current.start_time, previous.end_time)

    def test_exhausted_cycle_still_prepends_a_restart(self):
        events = plan(cycle_hours_used='70').events

        self.assertEqual(events[0].event_type, EventType.CYCLE_RESTART_34)
        self.assertEqual(
            [e.event_type for e in events].count(EventType.PRETRIP_INSPECTION), 1
        )

    def test_evaluator_call_count_per_leg_is_unchanged(self):
        # One evaluation pass per leg, five evaluators, no block.
        result = plan()

        self.assertEqual(len(result.rule_results), 2 * len(default_evaluators()))
