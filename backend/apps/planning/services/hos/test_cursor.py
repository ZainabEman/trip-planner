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
from apps.planning.services.hos.event_factory import EventFactory
from apps.planning.services.hos.models import PlanningContext, RouteLegInput

START = datetime(2026, 8, 1, 8, 0, tzinfo=dt_timezone.utc)


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

    def test_off_duty_passes_time_without_accruing_duty_or_cycle(self):
        cursor = self.cursor('40')
        cursor.advance(PlannerAction.CYCLE_RESTART, Decimal('34'), counts_as_on_duty=False)

        self.assertEqual(cursor.current_time, START + timedelta(hours=34))
        self.assertEqual(cursor.clocks.elapsed_hours, Decimal('34'))
        self.assertEqual(cursor.clocks.duty_window_hours, Decimal('0'))
        # The cycle carries the hours it arrived with; the restart clears it
        # separately, which is a different operation.
        self.assertEqual(cursor.clocks.cycle_hours, Decimal('40'))

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
    """A blocked leg now records where it stopped — the input Phase 12B needs."""

    def blocked(self):
        # 20 hours of driving on leg 2 breaches the 14-hour duty window.
        return plan(make_leg(1, 46, '35.90'), make_leg(2, 20 * 60, '1100.00'))

    def test_a_blocked_trip_still_returns_no_events(self):
        result = self.blocked()

        # Unchanged behaviour: no partial timeline is emitted (BR-37, FR-4.5).
        self.assertEqual(result.events, ())
        self.assertEqual(result.days, ())

    def test_the_pause_names_the_leg_and_the_blocking_rule(self):
        pause = self.blocked().pause

        self.assertIsNotNone(pause)
        self.assertEqual(pause.leg_sequence, 2)
        self.assertEqual(pause.rule_id, 'BR-2')
        self.assertEqual(pause.evaluator_name, 'DutyWindowEvaluator')
        self.assertEqual(pause.required_action, 'reset_10')

    def test_the_pause_splits_the_leg_into_drivable_and_remaining(self):
        pause = self.blocked().pause

        # The two parts must reconstitute the leg exactly — that is what makes
        # the record usable for resuming rather than merely informative.
        self.assertAlmostEqual(
            pause.drivable_miles + pause.remaining_distance_miles,
            Decimal('1100.00'),
            places=2,
        )
        self.assertGreater(pause.drivable_miles, 0)
        self.assertGreater(pause.remaining_distance_miles, 0)
        self.assertGreater(pause.remaining_duration_minutes, 0)
        self.assertLess(pause.remaining_duration_minutes, 20 * 60)

    def test_the_pause_captures_the_clocks_and_the_moment(self):
        result = self.blocked()
        pause = result.pause

        # Paused after leg 1 and its pickup: pre-trip 0.25 + drive 0.766 + pickup 1.
        self.assertEqual(pause.clocks.duty_window_hours, pause.clocks.cycle_hours)
        self.assertGreater(pause.clocks.elapsed_hours, Decimal('0'))
        self.assertEqual(pause.paused_at, START + timedelta(minutes=15 + 46 + 60))

    def test_a_successful_plan_records_no_pause(self):
        self.assertIsNone(plan().pause)

    def test_planning_stops_at_the_first_pause(self):
        # Leg 2 blocks, so leg 3 is never evaluated.
        result = plan(
            make_leg(1, 46, '35.90'),
            make_leg(2, 20 * 60, '1100.00'),
            make_leg(3, 60, '50.00'),
        )

        self.assertEqual(result.pause.leg_sequence, 2)


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
