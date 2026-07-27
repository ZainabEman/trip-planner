"""Phase 5 — TripPlanningService persistence tests.

These hit the database (TimelineEvent rows, Trip status transitions), so they
use TestCase rather than SimpleTestCase. RoutingService is stubbed: the
provider is a network dependency and the route's *content* is what matters
here, not how it was obtained.
"""
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

from django.test import TestCase

from apps.planning.choices import DutyStatus, EventType, TripStatus
from apps.planning.models import TimelineEvent, Trip
from apps.planning.services.hos.engine import PlanningEngine
from apps.planning.services.hos.evaluators import default_evaluators
from apps.planning.services.hos.test_cursor import UnremediableEvaluator
from apps.planning.services.planning_service import (
    TripNotPlannableError,
    TripPlanningService,
)
from apps.planning.services.routing.models import GeocodedLocation, RouteLegResult, RouteResult

START = datetime(2026, 7, 27, 8, 0, tzinfo=dt_timezone.utc)

DALLAS = GeocodedLocation('Dallas, TX', 'Dallas, Texas', 32.7767, -96.7970)
FORT_WORTH = GeocodedLocation('Fort Worth, TX', 'Fort Worth, Texas', 32.7555, -97.3308)
CHICAGO = GeocodedLocation('Chicago, IL', 'Chicago, Illinois', 41.8781, -87.6298)


def route_result(leg_2_minutes: int = 180) -> RouteResult:
    return RouteResult(
        legs=[
            RouteLegResult(1, DALLAS, FORT_WORTH, Decimal('35.00'), 120, 'poly1'),
            RouteLegResult(2, FORT_WORTH, CHICAGO, Decimal('900.00'), leg_2_minutes, 'poly2'),
        ],
        total_distance_miles=Decimal('935.00'),
        total_duration_minutes=120 + leg_2_minutes,
    )


class StubRoutingService:
    """Stands in for RoutingService, returning a fixed RouteResult.

    TripPlanningService consumes only the returned RouteResult (the geocoded
    coordinates live there, not on the persisted RouteLeg rows), so a stub
    that skips persistence is sufficient for these tests.
    """

    def __init__(self, result: RouteResult | None = None) -> None:
        self.result = result or route_result()
        self.calls: list[Trip] = []

    def plan_route_for_trip(self, trip: Trip) -> RouteResult:
        self.calls.append(trip)
        return self.result


def make_trip(cycle_hours_used: str = '10.00') -> Trip:
    return Trip.objects.create(
        current_location_text='Dallas, TX',
        pickup_location_text='Fort Worth, TX',
        dropoff_location_text='Chicago, IL',
        cycle_hours_used=Decimal(cycle_hours_used),
        trip_start_time=START,
    )


def make_service(routing: StubRoutingService | None = None) -> TripPlanningService:
    return TripPlanningService(
        routing_service=routing or StubRoutingService(),
        engine=PlanningEngine(evaluators=default_evaluators()),
    )


class TimelinePersistenceTests(TestCase):
    def test_plan_trip_persists_every_event(self):
        trip = make_trip()

        result = make_service().plan_trip(trip)

        self.assertEqual(TimelineEvent.objects.filter(trip=trip).count(), 6)
        self.assertEqual(result.event_count, 6)

    def test_persisted_events_keep_the_engine_order_and_sequence(self):
        trip = make_trip()
        make_service().plan_trip(trip)

        rows = list(TimelineEvent.objects.filter(trip=trip))

        self.assertEqual([row.sequence for row in rows], [1, 2, 3, 4, 5, 6])
        self.assertEqual(
            [row.event_type for row in rows],
            [
                EventType.PRETRIP_INSPECTION,
                EventType.DRIVE,
                EventType.PICKUP,
                EventType.DRIVE,
                EventType.DROPOFF,
                EventType.POSTTRIP_INSPECTION,
            ],
        )

    def test_persisted_events_are_contiguous(self):
        trip = make_trip()
        make_service().plan_trip(trip)

        rows = list(TimelineEvent.objects.filter(trip=trip))

        self.assertEqual(rows[0].start_time, START)
        for previous, current in zip(rows, rows[1:]):
            with self.subTest(sequence=current.sequence):
                self.assertEqual(current.start_time, previous.end_time)

    def test_coordinates_are_stored_at_six_decimal_places(self):
        trip = make_trip()
        make_service().plan_trip(trip)

        pretrip = TimelineEvent.objects.get(trip=trip, sequence=1)

        self.assertEqual(pretrip.latitude, Decimal('32.776700'))
        self.assertEqual(pretrip.longitude, Decimal('-96.797000'))

    def test_distance_is_stored_only_for_driving_rows(self):
        trip = make_trip()
        make_service().plan_trip(trip)

        for row in TimelineEvent.objects.filter(trip=trip):
            with self.subTest(sequence=row.sequence):
                if row.event_type == EventType.DRIVE:
                    self.assertIsNotNone(row.distance_miles)
                else:
                    self.assertIsNone(row.distance_miles)

        self.assertEqual(
            [
                row.distance_miles
                for row in TimelineEvent.objects.filter(trip=trip, event_type=EventType.DRIVE)
            ],
            [Decimal('35.00'), Decimal('900.00')],
        )

    def test_every_persisted_row_has_a_location_and_reason(self):
        trip = make_trip()
        make_service().plan_trip(trip)

        for row in TimelineEvent.objects.filter(trip=trip):
            with self.subTest(sequence=row.sequence):
                self.assertTrue(row.location_name)
                self.assertTrue(row.reason)

    def test_trip_status_becomes_planned(self):
        trip = make_trip()

        make_service().plan_trip(trip)

        trip.refresh_from_db()
        self.assertEqual(trip.status, TripStatus.PLANNED)

    def test_routing_is_invoked_before_planning(self):
        routing = StubRoutingService()
        trip = make_trip()

        make_service(routing).plan_trip(trip)

        self.assertEqual(routing.calls, [trip])

    def test_replanning_replaces_the_previous_timeline(self):
        trip = make_trip()
        service = make_service()

        service.plan_trip(trip)
        first_ids = set(TimelineEvent.objects.filter(trip=trip).values_list('id', flat=True))
        service.plan_trip(trip)

        rows = TimelineEvent.objects.filter(trip=trip)
        self.assertEqual(rows.count(), 6)  # not 12
        self.assertFalse(first_ids & set(rows.values_list('id', flat=True)))
        self.assertEqual([row.sequence for row in rows], [1, 2, 3, 4, 5, 6])


class PlanningMetricsTests(TestCase):
    def test_duty_hours_are_aggregated_from_the_timeline(self):
        trip = make_trip()

        result = make_service().plan_trip(trip)

        # 2h + 3h driving; 15m pretrip + 1h pickup + 1h dropoff + 15m posttrip.
        self.assertEqual(result.driving_hours, Decimal('5'))
        self.assertEqual(result.on_duty_hours, Decimal('2.5'))
        self.assertEqual(result.off_duty_hours, Decimal('0'))

    def test_total_elapsed_spans_first_start_to_last_end(self):
        trip = make_trip()

        result = make_service().plan_trip(trip)

        self.assertEqual(result.total_elapsed_hours, Decimal('7.5'))

    def test_restart_is_counted_as_off_duty_time(self):
        trip = make_trip(cycle_hours_used='70.00')

        result = make_service().plan_trip(trip)

        self.assertEqual(result.off_duty_hours, Decimal('34'))
        self.assertEqual(result.total_elapsed_hours, Decimal('41.5'))

    def test_routing_totals_are_left_untouched_by_planning(self):
        # RoutingService owns total_distance_miles/total_duration_minutes;
        # planning must not repurpose them for timeline elapsed time.
        trip = make_trip()
        trip.total_distance_miles = Decimal('935.00')
        trip.total_duration_minutes = 300
        trip.save()

        make_service().plan_trip(trip)

        trip.refresh_from_db()
        self.assertEqual(trip.total_distance_miles, Decimal('935.00'))
        self.assertEqual(trip.total_duration_minutes, 300)


class MultiDayPersistenceTests(TestCase):
    """A 20-hour leg used to be unplannable. It is now a two-day schedule, and
    the whole of it has to survive the round trip to the database.
    """

    def _planned(self):
        trip = make_trip()
        service = make_service(StubRoutingService(route_result(leg_2_minutes=20 * 60)))
        return trip, service.plan_trip(trip)

    def test_remedy_events_are_persisted(self):
        trip, _ = self._planned()

        stored = [row.event_type for row in TimelineEvent.objects.filter(trip=trip)]

        self.assertIn(EventType.REST_BREAK_30, stored)
        self.assertIn(EventType.DAILY_REST_10, stored)
        self.assertEqual(stored[-1], EventType.POSTTRIP_INSPECTION)

    def test_the_persisted_timeline_is_still_gap_free_across_days(self):
        trip, _ = self._planned()

        rows = list(TimelineEvent.objects.filter(trip=trip))

        self.assertGreater(rows[-1].end_time - rows[0].start_time, timedelta(days=1))
        for previous, current in zip(rows, rows[1:]):
            with self.subTest(sequence=current.sequence):
                self.assertEqual(current.start_time, previous.end_time)

    def test_split_driving_distances_still_sum_to_the_route(self):
        # Persistence quantises to two decimal places, so this checks the split
        # survives the database rather than only the engine.
        trip, _ = self._planned()

        driven = sum(
            row.distance_miles
            for row in TimelineEvent.objects.filter(trip=trip, event_type=EventType.DRIVE)
        )

        self.assertEqual(driven, Decimal('935.00'))

    def test_off_duty_hours_include_the_inserted_rest(self):
        _, result = self._planned()

        # One 10-hour reset plus a 30-minute break in each of the two duty
        # periods — BR-4's trigger fires once per period, since the reset
        # clears it along with everything else.
        self.assertEqual(result.off_duty_hours, Decimal('11.0'))
        # Driving is the whole route's duration and no more: 2h on leg 1 plus
        # the 20h of leg 2, split but not lengthened.
        self.assertEqual(result.driving_hours, Decimal('22'))


class PlanningFailureTests(TestCase):
    def _unplannable_service(self) -> TripPlanningService:
        # Since remedies were introduced a long trip is not unplannable, only
        # slow — it takes more days. Reaching the failure path takes a rule
        # that names no remedy at all.
        return TripPlanningService(
            routing_service=StubRoutingService(),
            engine=PlanningEngine(evaluators=[*default_evaluators(), UnremediableEvaluator()]),
        )

    def test_unplannable_trip_raises(self):
        trip = make_trip()

        with self.assertRaises(TripNotPlannableError):
            self._unplannable_service().plan_trip(trip)

    def test_unplannable_trip_persists_no_events(self):
        trip = make_trip()

        with self.assertRaises(TripNotPlannableError):
            self._unplannable_service().plan_trip(trip)

        self.assertEqual(TimelineEvent.objects.filter(trip=trip).count(), 0)

    def test_unplannable_trip_is_marked_failed(self):
        trip = make_trip()

        with self.assertRaises(TripNotPlannableError):
            self._unplannable_service().plan_trip(trip)

        trip.refresh_from_db()
        self.assertEqual(trip.status, TripStatus.FAILED)

    def test_failure_names_the_blocking_rule(self):
        trip = make_trip()

        with self.assertRaises(TripNotPlannableError) as ctx:
            self._unplannable_service().plan_trip(trip)

        # Structured, so an API layer can surface them as fields rather than
        # parsing them back out of the message. The rule named is the one the
        # engine could not get past — taken from the pause, not from the last
        # blocked RuleResult, which on a multi-day plan is just wherever a
        # break happened to be due.
        self.assertEqual(ctx.exception.rule_id, 'BR-TEST')
        self.assertEqual(ctx.exception.evaluator_name, 'UnremediableEvaluator')
        self.assertIn('nothing can make it legal', ctx.exception.reason)
        self.assertEqual(ctx.exception.trip_id, trip.id)

    def test_a_previously_planned_timeline_is_cleared_on_a_failed_replan(self):
        trip = make_trip()
        make_service().plan_trip(trip)
        self.assertEqual(TimelineEvent.objects.filter(trip=trip).count(), 6)

        with self.assertRaises(TripNotPlannableError):
            self._unplannable_service().plan_trip(trip)

        trip.refresh_from_db()
        self.assertEqual(trip.status, TripStatus.FAILED)
        # The stale timeline must not survive as the "current" plan for a trip
        # now marked failed.
        self.assertEqual(TimelineEvent.objects.filter(trip=trip).count(), 0)


class AtomicityTests(TestCase):
    def test_nothing_is_persisted_if_the_write_fails_partway(self):
        trip = make_trip()
        service = make_service()

        # Force a failure after the delete but during the row insert.
        original = TimelineEvent.objects.bulk_create

        def exploding_bulk_create(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError('simulated database failure')

        TimelineEvent.objects.bulk_create = exploding_bulk_create
        try:
            with self.assertRaises(RuntimeError):
                service.plan_trip(trip)
        finally:
            TimelineEvent.objects.bulk_create = original

        trip.refresh_from_db()
        self.assertEqual(TimelineEvent.objects.filter(trip=trip).count(), 0)
        self.assertNotEqual(trip.status, TripStatus.PLANNED)


class DutyStatusCoverageTests(TestCase):
    def test_persisted_duty_statuses_are_all_valid_choices(self):
        trip = make_trip(cycle_hours_used='70.00')
        make_service().plan_trip(trip)

        for row in TimelineEvent.objects.filter(trip=trip):
            with self.subTest(sequence=row.sequence):
                self.assertIn(row.duty_status, DutyStatus.values)
                self.assertIn(row.event_type, EventType.values)

    def test_daily_totals_have_no_gaps_so_they_can_sum_per_day(self):
        # BR-28's "daily totals sum to 24h" is guaranteed downstream only if
        # the persisted timeline is gap-free; assert that property directly.
        trip = make_trip()
        make_service().plan_trip(trip)

        rows = list(TimelineEvent.objects.filter(trip=trip))
        covered = sum((row.end_time - row.start_time for row in rows), timedelta())

        self.assertEqual(covered, rows[-1].end_time - rows[0].start_time)
