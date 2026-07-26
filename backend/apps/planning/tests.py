from decimal import Decimal

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from apps.planning.choices import DutyStatus, EventType, LegType, TripStatus
from apps.planning.models import RouteLeg, TimelineEvent, Trip


def make_trip(**overrides):
    defaults = {
        'current_location_text': 'Dallas, TX',
        'pickup_location_text': 'Fort Worth, TX',
        'dropoff_location_text': 'Chicago, IL',
        'cycle_hours_used': Decimal('10.00'),
        'trip_start_time': timezone.now(),
    }
    defaults.update(overrides)
    return Trip.objects.create(**defaults)


class TripModelTests(TestCase):
    def test_create_trip_with_defaults(self):
        trip = make_trip()

        self.assertIsNotNone(trip.id)
        self.assertEqual(trip.status, TripStatus.PENDING)
        self.assertIsNone(trip.total_distance_miles)
        self.assertIsNone(trip.total_duration_minutes)
        self.assertIsNotNone(trip.created_at)
        self.assertIsNotNone(trip.updated_at)

    def test_trip_status_can_be_set_to_valid_choice(self):
        trip = make_trip(status=TripStatus.PLANNED)
        self.assertEqual(trip.status, TripStatus.PLANNED)

    def test_updated_at_changes_on_save(self):
        trip = make_trip()
        original_updated_at = trip.updated_at

        trip.status = TripStatus.FAILED
        trip.save()
        trip.refresh_from_db()

        self.assertGreaterEqual(trip.updated_at, original_updated_at)

    def test_trip_str_contains_pickup_and_dropoff(self):
        trip = make_trip()
        self.assertIn(trip.pickup_location_text, str(trip))
        self.assertIn(trip.dropoff_location_text, str(trip))


class RouteLegModelTests(TestCase):
    def setUp(self):
        self.trip = make_trip()

    def test_create_route_leg(self):
        leg = RouteLeg.objects.create(
            trip=self.trip,
            sequence=1,
            leg_type=LegType.DEADHEAD,
            origin_text='Dallas, TX',
            destination_text='Fort Worth, TX',
            distance_miles=Decimal('35.00'),
            duration_minutes=40,
            encoded_polyline='abc123',
        )

        self.assertEqual(leg.trip, self.trip)
        self.assertEqual(leg.leg_type, LegType.DEADHEAD)

    def test_route_legs_ordered_by_sequence(self):
        RouteLeg.objects.create(
            trip=self.trip,
            sequence=2,
            leg_type=LegType.LOADED,
            origin_text='Fort Worth, TX',
            destination_text='Chicago, IL',
            distance_miles=Decimal('900.00'),
            duration_minutes=900,
            encoded_polyline='leg2',
        )
        RouteLeg.objects.create(
            trip=self.trip,
            sequence=1,
            leg_type=LegType.DEADHEAD,
            origin_text='Dallas, TX',
            destination_text='Fort Worth, TX',
            distance_miles=Decimal('35.00'),
            duration_minutes=40,
            encoded_polyline='leg1',
        )

        sequences = list(self.trip.route_legs.values_list('sequence', flat=True))
        self.assertEqual(sequences, [1, 2])

    def test_duplicate_sequence_for_same_trip_is_rejected(self):
        RouteLeg.objects.create(
            trip=self.trip,
            sequence=1,
            leg_type=LegType.DEADHEAD,
            origin_text='Dallas, TX',
            destination_text='Fort Worth, TX',
            distance_miles=Decimal('35.00'),
            duration_minutes=40,
            encoded_polyline='leg1',
        )

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                RouteLeg.objects.create(
                    trip=self.trip,
                    sequence=1,
                    leg_type=LegType.LOADED,
                    origin_text='Fort Worth, TX',
                    destination_text='Chicago, IL',
                    distance_miles=Decimal('900.00'),
                    duration_minutes=900,
                    encoded_polyline='leg1-duplicate',
                )

    def test_route_legs_deleted_when_trip_deleted(self):
        RouteLeg.objects.create(
            trip=self.trip,
            sequence=1,
            leg_type=LegType.DEADHEAD,
            origin_text='Dallas, TX',
            destination_text='Fort Worth, TX',
            distance_miles=Decimal('35.00'),
            duration_minutes=40,
            encoded_polyline='leg1',
        )

        self.trip.delete()

        self.assertEqual(RouteLeg.objects.count(), 0)


class TimelineEventModelTests(TestCase):
    def setUp(self):
        self.trip = make_trip()
        self.start = timezone.now()

    def test_create_timeline_event(self):
        event = TimelineEvent.objects.create(
            trip=self.trip,
            sequence=1,
            start_time=self.start,
            end_time=self.start + timezone.timedelta(hours=1),
            duty_status=DutyStatus.ON_DUTY_NOT_DRIVING,
            event_type=EventType.PICKUP,
            location_name='Fort Worth, TX',
            latitude=Decimal('32.755000'),
            longitude=Decimal('-97.330000'),
            reason='Pickup consumes 1 hour of On Duty (Not Driving).',
        )

        self.assertEqual(event.trip, self.trip)
        self.assertIsNone(event.distance_miles)

    def test_timeline_events_ordered_by_sequence(self):
        TimelineEvent.objects.create(
            trip=self.trip,
            sequence=2,
            start_time=self.start + timezone.timedelta(hours=1),
            end_time=self.start + timezone.timedelta(hours=5),
            duty_status=DutyStatus.DRIVING,
            event_type=EventType.DRIVE,
            location_name='En route',
            latitude=Decimal('32.755000'),
            longitude=Decimal('-97.330000'),
            distance_miles=Decimal('250.00'),
            reason='Driving leg 2.',
        )
        TimelineEvent.objects.create(
            trip=self.trip,
            sequence=1,
            start_time=self.start,
            end_time=self.start + timezone.timedelta(hours=1),
            duty_status=DutyStatus.ON_DUTY_NOT_DRIVING,
            event_type=EventType.PICKUP,
            location_name='Fort Worth, TX',
            latitude=Decimal('32.755000'),
            longitude=Decimal('-97.330000'),
            reason='Pickup.',
        )

        sequences = list(self.trip.timeline_events.values_list('sequence', flat=True))
        self.assertEqual(sequences, [1, 2])

    def test_duplicate_sequence_for_same_trip_is_rejected(self):
        TimelineEvent.objects.create(
            trip=self.trip,
            sequence=1,
            start_time=self.start,
            end_time=self.start + timezone.timedelta(hours=1),
            duty_status=DutyStatus.ON_DUTY_NOT_DRIVING,
            event_type=EventType.PICKUP,
            location_name='Fort Worth, TX',
            latitude=Decimal('32.755000'),
            longitude=Decimal('-97.330000'),
            reason='Pickup.',
        )

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                TimelineEvent.objects.create(
                    trip=self.trip,
                    sequence=1,
                    start_time=self.start,
                    end_time=self.start + timezone.timedelta(hours=1),
                    duty_status=DutyStatus.DRIVING,
                    event_type=EventType.DRIVE,
                    location_name='Duplicate',
                    latitude=Decimal('32.755000'),
                    longitude=Decimal('-97.330000'),
                    reason='Duplicate sequence.',
                )

    def test_timeline_events_deleted_when_trip_deleted(self):
        TimelineEvent.objects.create(
            trip=self.trip,
            sequence=1,
            start_time=self.start,
            end_time=self.start + timezone.timedelta(hours=1),
            duty_status=DutyStatus.ON_DUTY_NOT_DRIVING,
            event_type=EventType.PICKUP,
            location_name='Fort Worth, TX',
            latitude=Decimal('32.755000'),
            longitude=Decimal('-97.330000'),
            reason='Pickup.',
        )

        self.trip.delete()

        self.assertEqual(TimelineEvent.objects.count(), 0)
