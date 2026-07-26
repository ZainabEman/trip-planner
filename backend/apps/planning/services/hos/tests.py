"""Unit tests for the Phase 4C.1 HOS engine foundation.

No FMCSA rule behavior is tested here — there isn't any yet. These tests
verify only the scaffolding: PlanningContext construction, state
transitions, EventFactory construction, TimelineBuilder ordering, and
that PlanningEngine's pipeline is wired together end-to-end.
"""
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

from django.test import SimpleTestCase

from apps.planning.choices import DutyStatus, EventType
from apps.planning.services.hos.engine import PlanningEngine
from apps.planning.services.hos.event_factory import EventFactory
from apps.planning.services.hos.exceptions import (
    InvalidPlanningContextError,
    InvalidStateTransitionError,
    TimelineAssemblyError,
)
from apps.planning.services.hos.models import EngineEvent, PlanningContext, PlanningResult, RouteLegInput
from apps.planning.services.hos.state_machine import DutyState, StateMachine
from apps.planning.services.hos.timeline_builder import TimelineBuilder

START = datetime(2026, 7, 27, 8, 0, tzinfo=dt_timezone.utc)


def make_route_leg(sequence=1, distance=Decimal('100.00')):
    return RouteLegInput(
        sequence=sequence,
        origin_text='Dallas, TX',
        destination_text='Fort Worth, TX',
        origin_latitude=32.7767,
        origin_longitude=-96.7970,
        destination_latitude=32.7555,
        destination_longitude=-97.3308,
        distance_miles=distance,
        duration_minutes=120,
    )


def make_context(**overrides):
    defaults = dict(
        trip_id=uuid.uuid4(),
        current_location_text='Dallas, TX',
        pickup_location_text='Fort Worth, TX',
        dropoff_location_text='Chicago, IL',
        trip_start_time=START,
        cycle_hours_used=Decimal('10.00'),
        route_legs=(make_route_leg(),),
    )
    defaults.update(overrides)
    return PlanningContext(**defaults)


def make_event(start, end, event_type=EventType.DRIVE, duty_status=DutyStatus.DRIVING):
    return EventFactory.create_event(
        start_time=start,
        end_time=end,
        duty_status=duty_status,
        event_type=event_type,
        location_name='loc',
        latitude=0.0,
        longitude=0.0,
        reason='reason',
    )


class PlanningContextTests(SimpleTestCase):
    def test_constructs_with_valid_inputs(self):
        context = make_context()
        self.assertEqual(context.cycle_hours_used, Decimal('10.00'))
        self.assertEqual(len(context.route_legs), 1)
        self.assertEqual(context.route_legs[0].origin_text, 'Dallas, TX')

    def test_rejects_empty_route_legs(self):
        with self.assertRaises(InvalidPlanningContextError):
            make_context(route_legs=())

    def test_rejects_negative_cycle_hours_used(self):
        with self.assertRaises(InvalidPlanningContextError):
            make_context(cycle_hours_used=Decimal('-1'))

    def test_accepts_zero_cycle_hours_used(self):
        context = make_context(cycle_hours_used=Decimal('0'))
        self.assertEqual(context.cycle_hours_used, Decimal('0'))

    def test_is_immutable(self):
        context = make_context()
        with self.assertRaises(Exception):
            context.cycle_hours_used = Decimal('20.00')


class StateMachineTests(SimpleTestCase):
    def test_initial_state_defaults_to_off_duty(self):
        sm = StateMachine()
        self.assertEqual(sm.current_state, DutyState.OFF_DUTY)
        self.assertEqual(sm.history, ())

    def test_initial_state_can_be_overridden(self):
        sm = StateMachine(initial_state=DutyState.DRIVING)
        self.assertEqual(sm.current_state, DutyState.DRIVING)

    def test_transition_updates_current_state(self):
        sm = StateMachine(initialized_at=START)
        sm.transition_to(
            DutyState.ON_DUTY, occurred_at=START + timedelta(minutes=15), reason='Pre-trip inspection complete'
        )
        self.assertEqual(sm.current_state, DutyState.ON_DUTY)

    def test_transition_recorded_in_history(self):
        sm = StateMachine(initialized_at=START)
        transition = sm.transition_to(DutyState.ON_DUTY, occurred_at=START + timedelta(minutes=15), reason='test')

        self.assertEqual(len(sm.history), 1)
        self.assertEqual(sm.history[0], transition)
        self.assertEqual(transition.from_state, DutyState.OFF_DUTY)
        self.assertEqual(transition.to_state, DutyState.ON_DUTY)
        self.assertEqual(transition.reason, 'test')

    def test_sequential_transitions_maintain_order(self):
        sm = StateMachine(initialized_at=START)
        sm.transition_to(DutyState.ON_DUTY, occurred_at=START + timedelta(minutes=15))
        sm.transition_to(DutyState.DRIVING, occurred_at=START + timedelta(minutes=30))
        sm.transition_to(DutyState.BREAK, occurred_at=START + timedelta(hours=8))

        self.assertEqual(
            [t.to_state for t in sm.history], [DutyState.ON_DUTY, DutyState.DRIVING, DutyState.BREAK]
        )
        self.assertEqual(sm.current_state, DutyState.BREAK)

    def test_rejects_out_of_order_transition(self):
        sm = StateMachine(initialized_at=START)
        sm.transition_to(DutyState.ON_DUTY, occurred_at=START + timedelta(hours=1))

        with self.assertRaises(InvalidStateTransitionError):
            sm.transition_to(DutyState.DRIVING, occurred_at=START + timedelta(minutes=30))


class EventFactoryTests(SimpleTestCase):
    def test_creates_engine_event_with_given_values(self):
        event = EventFactory.create_event(
            start_time=START,
            end_time=START + timedelta(minutes=15),
            duty_status=DutyStatus.ON_DUTY_NOT_DRIVING,
            event_type=EventType.PRETRIP_INSPECTION,
            location_name='Dallas, TX',
            latitude=32.7767,
            longitude=-96.7970,
            reason='Pre-trip inspection.',
        )

        self.assertIsInstance(event, EngineEvent)
        self.assertIsNone(event.sequence)
        self.assertEqual(event.duty_status, DutyStatus.ON_DUTY_NOT_DRIVING)
        self.assertEqual(event.event_type, EventType.PRETRIP_INSPECTION)
        self.assertEqual(event.location_name, 'Dallas, TX')
        self.assertIsNone(event.distance_miles)

    def test_creates_event_with_optional_distance(self):
        event = EventFactory.create_event(
            start_time=START,
            end_time=START + timedelta(hours=2),
            duty_status=DutyStatus.DRIVING,
            event_type=EventType.DRIVE,
            location_name='En route',
            latitude=32.0,
            longitude=-97.0,
            reason='Driving leg 1.',
            distance_miles=Decimal('100.00'),
        )

        self.assertEqual(event.distance_miles, Decimal('100.00'))

    def test_passes_start_and_end_times_through_unmodified(self):
        end = START + timedelta(minutes=30)
        event = EventFactory.create_event(
            start_time=START,
            end_time=end,
            duty_status=DutyStatus.OFF_DUTY,
            event_type=EventType.DAILY_REST_10,
            location_name='X',
            latitude=0.0,
            longitude=0.0,
            reason='r',
        )

        self.assertEqual(event.start_time, START)
        self.assertEqual(event.end_time, end)


class TimelineBuilderTests(SimpleTestCase):
    def test_build_orders_events_chronologically_regardless_of_insertion_order(self):
        builder = TimelineBuilder()
        second = make_event(START + timedelta(hours=1), START + timedelta(hours=2))
        first = make_event(START, START + timedelta(hours=1))
        builder.add_event(second)
        builder.add_event(first)

        result = builder.build()

        self.assertEqual([e.start_time for e in result], [START, START + timedelta(hours=1)])

    def test_build_assigns_sequence_numbers_in_chronological_order(self):
        builder = TimelineBuilder()
        builder.add_event(make_event(START + timedelta(hours=1), START + timedelta(hours=2)))
        builder.add_event(make_event(START, START + timedelta(hours=1)))

        result = builder.build()

        self.assertEqual([e.sequence for e in result], [1, 2])
        self.assertEqual(result[0].start_time, START)

    def test_build_with_no_events_returns_empty_list(self):
        builder = TimelineBuilder()
        self.assertEqual(builder.build(), [])

    def test_build_raises_on_overlapping_events(self):
        builder = TimelineBuilder()
        builder.add_event(make_event(START, START + timedelta(hours=2)))
        builder.add_event(make_event(START + timedelta(hours=1), START + timedelta(hours=3)))

        with self.assertRaises(TimelineAssemblyError):
            builder.build()

    def test_build_allows_back_to_back_events(self):
        builder = TimelineBuilder()
        builder.add_event(make_event(START, START + timedelta(hours=1)))
        builder.add_event(make_event(START + timedelta(hours=1), START + timedelta(hours=2)))

        result = builder.build()

        self.assertEqual(len(result), 2)


class PlanningEngineTests(SimpleTestCase):
    def test_plan_returns_planning_result_wrapping_the_context(self):
        engine = PlanningEngine()
        context = make_context()

        result = engine.plan(context)

        self.assertIsInstance(result, PlanningResult)
        self.assertIs(result.context, context)

    def test_plan_with_no_evaluators_still_produces_a_timeline(self):
        # Evaluators constrain a plan; they are not what builds it. With none
        # registered nothing can block, so the full timeline is produced.
        engine = PlanningEngine(evaluators=[])
        result = engine.plan(make_context())

        self.assertEqual(
            [event.event_type for event in result.events],
            [
                EventType.PRETRIP_INSPECTION,
                EventType.DRIVE,
                EventType.DROPOFF,
                EventType.POSTTRIP_INSPECTION,
            ],
        )
        self.assertEqual(result.rule_results, ())
