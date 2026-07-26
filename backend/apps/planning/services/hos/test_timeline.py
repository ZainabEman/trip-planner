"""Phase 5 — timeline generation tests.

Covers what PlanningEngine now *emits*, as distinct from what the evaluators
decide (evaluators/tests.py) and the scaffolding contracts (tests.py). These
are pure unit tests: no database, no routing provider.
"""
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

from django.test import SimpleTestCase

from apps.planning.choices import DutyStatus, EventType
from apps.planning.services.hos.engine import PlanningEngine
from apps.planning.services.hos.evaluators import default_evaluators
from apps.planning.services.hos.models import PlanningContext, RouteLegInput

START = datetime(2026, 7, 27, 8, 0, tzinfo=dt_timezone.utc)

# Leg 1: Dallas -> Fort Worth, 2h / 35mi. Leg 2: Fort Worth -> Chicago, 3h / 900mi.
LEG_1 = RouteLegInput(
    sequence=1,
    origin_text='Dallas, TX',
    destination_text='Fort Worth, TX',
    origin_latitude=32.7767,
    origin_longitude=-96.7970,
    destination_latitude=32.7555,
    destination_longitude=-97.3308,
    distance_miles=Decimal('35.00'),
    duration_minutes=120,
)
LEG_2 = RouteLegInput(
    sequence=2,
    origin_text='Fort Worth, TX',
    destination_text='Chicago, IL',
    origin_latitude=32.7555,
    origin_longitude=-97.3308,
    destination_latitude=41.8781,
    destination_longitude=-87.6298,
    distance_miles=Decimal('900.00'),
    duration_minutes=180,
)


def make_context(*legs, cycle_hours_used=Decimal('0')) -> PlanningContext:
    return PlanningContext(
        trip_id=uuid.uuid4(),
        current_location_text='Dallas, TX',
        pickup_location_text='Fort Worth, TX',
        dropoff_location_text='Chicago, IL',
        trip_start_time=START,
        cycle_hours_used=cycle_hours_used,
        route_legs=legs or (LEG_1, LEG_2),
    )


def plan(*legs, cycle_hours_used=Decimal('0')):
    engine = PlanningEngine(evaluators=default_evaluators())
    return engine.plan(make_context(*legs, cycle_hours_used=cycle_hours_used))


class TimelineShapeTests(SimpleTestCase):
    def test_two_leg_trip_produces_the_full_event_sequence(self):
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

    def test_timeline_is_no_longer_empty(self):
        self.assertTrue(plan().events)

    def test_single_leg_trip_ends_at_the_dropoff_not_a_pickup(self):
        event_types = [event.event_type for event in plan(LEG_1).events]

        self.assertEqual(
            event_types,
            [
                EventType.PRETRIP_INSPECTION,
                EventType.DRIVE,
                EventType.DROPOFF,
                EventType.POSTTRIP_INSPECTION,
            ],
        )
        self.assertNotIn(EventType.PICKUP, event_types)

    def test_duty_statuses_match_the_event_types(self):
        expected = {
            EventType.PRETRIP_INSPECTION: DutyStatus.ON_DUTY_NOT_DRIVING,
            EventType.DRIVE: DutyStatus.DRIVING,
            EventType.PICKUP: DutyStatus.ON_DUTY_NOT_DRIVING,
            EventType.DROPOFF: DutyStatus.ON_DUTY_NOT_DRIVING,
            EventType.POSTTRIP_INSPECTION: DutyStatus.ON_DUTY_NOT_DRIVING,
        }
        for event in plan().events:
            with self.subTest(event_type=event.event_type):
                self.assertEqual(event.duty_status, expected[event.event_type])


class TimelineInvariantTests(SimpleTestCase):
    def test_events_are_contiguous_with_no_gaps_or_overlaps(self):
        events = plan().events

        for previous, current in zip(events, events[1:]):
            with self.subTest(sequence=current.sequence):
                self.assertEqual(current.start_time, previous.end_time)

    def test_timeline_starts_exactly_at_trip_start_time(self):
        self.assertEqual(plan().events[0].start_time, START)

    def test_timeline_ends_at_delivery_completion(self):
        events = plan().events

        # 15m pretrip + 2h drive + 1h pickup + 3h drive + 1h dropoff + 15m posttrip
        self.assertEqual(events[-1].end_time, START + timedelta(hours=7, minutes=30))
        self.assertEqual(events[-1].event_type, EventType.POSTTRIP_INSPECTION)

    def test_no_event_has_zero_duration(self):
        for event in plan().events:
            with self.subTest(sequence=event.sequence):
                self.assertGreater(event.end_time, event.start_time)

    def test_sequence_numbers_are_one_based_and_contiguous(self):
        events = plan().events

        self.assertEqual([event.sequence for event in events], list(range(1, len(events) + 1)))

    def test_every_event_carries_every_required_field(self):
        for event in plan().events:
            with self.subTest(sequence=event.sequence):
                self.assertIsNotNone(event.sequence)
                self.assertIsNotNone(event.start_time)
                self.assertIsNotNone(event.end_time)
                self.assertIn(event.duty_status, DutyStatus.values)
                self.assertIn(event.event_type, EventType.values)
                self.assertTrue(event.location_name)
                self.assertIsInstance(event.latitude, float)
                self.assertIsInstance(event.longitude, float)
                self.assertTrue(event.reason)


class EventDetailTests(SimpleTestCase):
    def setUp(self):
        self.events = plan().events
        self.by_type = {}
        for event in self.events:
            self.by_type.setdefault(event.event_type, []).append(event)

    def test_pretrip_inspection_is_fifteen_minutes_at_the_current_location(self):
        pretrip = self.by_type[EventType.PRETRIP_INSPECTION][0]

        self.assertEqual(pretrip.end_time - pretrip.start_time, timedelta(minutes=15))
        self.assertEqual(pretrip.location_name, 'Dallas, TX')
        self.assertEqual(pretrip.latitude, LEG_1.origin_latitude)
        self.assertEqual(pretrip.longitude, LEG_1.origin_longitude)

    def test_driving_events_match_their_legs_duration_and_distance(self):
        first, second = self.by_type[EventType.DRIVE]

        self.assertEqual(first.end_time - first.start_time, timedelta(minutes=120))
        self.assertEqual(first.distance_miles, Decimal('35.00'))
        self.assertEqual(second.end_time - second.start_time, timedelta(minutes=180))
        self.assertEqual(second.distance_miles, Decimal('900.00'))

    def test_driving_events_are_located_at_their_legs_origin(self):
        first, second = self.by_type[EventType.DRIVE]

        self.assertEqual(first.location_name, LEG_1.origin_text)
        self.assertEqual(first.latitude, LEG_1.origin_latitude)
        self.assertEqual(second.location_name, LEG_2.origin_text)
        self.assertEqual(second.latitude, LEG_2.origin_latitude)

    def test_only_driving_events_carry_a_distance(self):
        for event in self.events:
            with self.subTest(sequence=event.sequence):
                if event.event_type == EventType.DRIVE:
                    self.assertIsNotNone(event.distance_miles)
                else:
                    self.assertIsNone(event.distance_miles)

    def test_pickup_is_one_hour_at_the_pickup_location(self):
        pickup = self.by_type[EventType.PICKUP][0]

        self.assertEqual(pickup.end_time - pickup.start_time, timedelta(hours=1))
        self.assertEqual(pickup.location_name, 'Fort Worth, TX')
        self.assertEqual(pickup.latitude, LEG_1.destination_latitude)

    def test_dropoff_is_one_hour_at_the_dropoff_location(self):
        dropoff = self.by_type[EventType.DROPOFF][0]

        self.assertEqual(dropoff.end_time - dropoff.start_time, timedelta(hours=1))
        self.assertEqual(dropoff.location_name, 'Chicago, IL')
        self.assertEqual(dropoff.latitude, LEG_2.destination_latitude)

    def test_posttrip_inspection_is_fifteen_minutes_after_the_dropoff(self):
        dropoff = self.by_type[EventType.DROPOFF][0]
        posttrip = self.by_type[EventType.POSTTRIP_INSPECTION][0]

        self.assertEqual(posttrip.start_time, dropoff.end_time)
        self.assertEqual(posttrip.end_time - posttrip.start_time, timedelta(minutes=15))
        self.assertEqual(posttrip.location_name, 'Chicago, IL')

    def test_every_reason_cites_a_business_rule(self):
        for event in self.events:
            with self.subTest(sequence=event.sequence):
                self.assertIn('BR-', event.reason)


class TimelineEdgeCaseTests(SimpleTestCase):
    def test_zero_duration_leg_contributes_no_driving_event(self):
        # EC-1: a same-location hop. BR-35 forbids a zero-length event, but
        # the arrival at the end of the leg still happens.
        same_location_leg = RouteLegInput(
            sequence=1,
            origin_text='Dallas, TX',
            destination_text='Dallas, TX',
            origin_latitude=32.7767,
            origin_longitude=-96.7970,
            destination_latitude=32.7767,
            destination_longitude=-96.7970,
            distance_miles=Decimal('0.00'),
            duration_minutes=0,
        )

        event_types = [event.event_type for event in plan(same_location_leg, LEG_2).events]

        self.assertEqual(event_types.count(EventType.DRIVE), 1)  # leg 2 only
        self.assertIn(EventType.PICKUP, event_types)

    def test_a_blocked_leg_produces_no_events_at_all(self):
        # A 20-hour leg breaches the 14-hour duty window. No remedy for that
        # is scheduled yet, so rather than a timeline that stops short of the
        # delivery the engine emits nothing (BR-37, FR-4.5).
        long_leg = RouteLegInput(
            sequence=1,
            origin_text='Dallas, TX',
            destination_text='Chicago, IL',
            origin_latitude=32.7767,
            origin_longitude=-96.7970,
            destination_latitude=41.8781,
            destination_longitude=-87.6298,
            distance_miles=Decimal('900.00'),
            duration_minutes=20 * 60,
        )

        result = plan(long_leg)

        self.assertEqual(result.events, ())
        self.assertTrue(any(not rule.allowed for rule in result.rule_results))

    def test_exhausted_cycle_prepends_a_restart_to_a_complete_timeline(self):
        result = plan(cycle_hours_used=Decimal('70'))

        event_types = [event.event_type for event in result.events]

        self.assertEqual(event_types[0], EventType.CYCLE_RESTART_34)
        # The restart opens the new duty period, so exactly one pre-trip.
        self.assertEqual(event_types.count(EventType.PRETRIP_INSPECTION), 1)
        self.assertEqual(event_types[-1], EventType.POSTTRIP_INSPECTION)
        # Still contiguous across the restart boundary.
        for previous, current in zip(result.events, result.events[1:]):
            self.assertEqual(current.start_time, previous.end_time)

    def test_restart_delays_the_whole_trip_by_thirty_four_hours(self):
        without = plan().events[-1].end_time
        with_restart = plan(cycle_hours_used=Decimal('70')).events[-1].end_time

        self.assertEqual(with_restart - without, timedelta(hours=34))
