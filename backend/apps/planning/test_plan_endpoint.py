"""Phase 6 — API tests for POST /api/trips/{id}/plan/.

The routing *provider* is stubbed rather than RoutingService itself, so the
real RoutingService runs and genuinely persists RouteLegs and the Trip's
route totals. Everything below the HTTP layer — routing service, HOS engine,
planning service, persistence, serializers — is the production code path;
only the network call is replaced.
"""
from datetime import datetime, timezone as dt_timezone
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse
from rest_framework import status

from apps.planning.choices import EventType, TripStatus
from apps.planning.models import RouteLeg, TimelineEvent, Trip
from apps.planning.services.planning_service import TripPlanningService
from apps.planning.services.routing.base import RoutingProvider
from apps.planning.services.routing.exceptions import (
    GeocodingError,
    RouteNotFoundError,
    RoutingConfigurationError,
    RoutingError,
    RoutingProviderUnavailableError,
)
from apps.planning.services.routing.models import GeocodedLocation, RouteLegResult, RouteResult
from apps.planning.services.routing.service import RoutingService

START = datetime(2026, 7, 27, 8, 0, tzinfo=dt_timezone.utc)

_POINTS = {
    'Dallas, TX': GeocodedLocation('Dallas, TX', 'Dallas, Texas', 32.7767, -96.7970),
    'Fort Worth, TX': GeocodedLocation('Fort Worth, TX', 'Fort Worth, Texas', 32.7555, -97.3308),
    'Chicago, IL': GeocodedLocation('Chicago, IL', 'Chicago, Illinois', 41.8781, -87.6298),
}


class StubProvider(RoutingProvider):
    """A RoutingProvider that answers from a fixed table, or raises."""

    def __init__(self, leg_2_minutes: int = 180, raises: Exception | None = None) -> None:
        self.leg_2_minutes = leg_2_minutes
        self.raises = raises

    def geocode(self, location: str) -> GeocodedLocation:
        if isinstance(self.raises, GeocodingError):
            raise self.raises
        return _POINTS[location]

    def calculate_route(self, current_location, pickup_location, dropoff_location) -> RouteResult:
        if self.raises is not None and not isinstance(self.raises, GeocodingError):
            raise self.raises
        return RouteResult(
            legs=[
                RouteLegResult(1, current_location, pickup_location, Decimal('35.00'), 120, 'poly1'),
                RouteLegResult(
                    2, pickup_location, dropoff_location,
                    Decimal('900.00'), self.leg_2_minutes, 'poly2',
                ),
            ],
            total_distance_miles=Decimal('935.00'),
            total_duration_minutes=120 + self.leg_2_minutes,
        )


def service_factory(provider: StubProvider):
    """Build the zero-arg factory the view's `TripPlanningService()` call needs."""

    def factory() -> TripPlanningService:
        return TripPlanningService(routing_service=RoutingService(provider=provider))

    return factory


class PlanEndpointTestCase(TestCase):
    def setUp(self):
        self.trip = self.make_trip()
        self.url = reverse('trip-plan', args=[self.trip.id])

    @staticmethod
    def make_trip(cycle_hours_used: str = '10.00') -> Trip:
        return Trip.objects.create(
            current_location_text='Dallas, TX',
            pickup_location_text='Fort Worth, TX',
            dropoff_location_text='Chicago, IL',
            cycle_hours_used=Decimal(cycle_hours_used),
            trip_start_time=START,
        )

    def plan(self, provider: StubProvider | None = None, url: str | None = None):
        with patch(
            'apps.planning.views.TripPlanningService',
            service_factory(provider or StubProvider()),
        ):
            return self.client.post(url or self.url)


class PlanEndpointSuccessTests(PlanEndpointTestCase):
    def test_returns_200(self):
        self.assertEqual(self.plan().status_code, status.HTTP_200_OK)

    def test_url_is_the_documented_path(self):
        self.assertEqual(self.url, f'/api/trips/{self.trip.id}/plan/')

    def test_response_contains_all_five_top_level_sections(self):
        body = self.plan().json()

        self.assertEqual(
            set(body),
            {'planning_status', 'trip', 'route', 'timeline', 'summary'},
        )

    def test_planning_status_is_planned(self):
        self.assertEqual(self.plan().json()['planning_status'], TripStatus.PLANNED)

    def test_trip_section_matches_the_trip_serializer(self):
        body = self.plan().json()

        self.assertEqual(body['trip']['id'], str(self.trip.id))
        self.assertEqual(body['trip']['status'], TripStatus.PLANNED)
        self.assertEqual(body['trip']['total_distance_miles'], '935.00')
        self.assertEqual(body['trip']['total_duration_minutes'], 300)

    def test_route_section_has_both_legs_in_order(self):
        route = self.plan().json()['route']

        self.assertEqual([leg['sequence'] for leg in route], [1, 2])
        self.assertEqual([leg['leg_type'] for leg in route], ['deadhead', 'loaded'])
        self.assertEqual(route[0]['origin_text'], 'Dallas, Texas')
        self.assertEqual(route[1]['destination_text'], 'Chicago, Illinois')

    def test_timeline_section_has_the_full_event_sequence(self):
        timeline = self.plan().json()['timeline']

        self.assertEqual([event['sequence'] for event in timeline], [1, 2, 3, 4, 5, 6])
        self.assertEqual(
            [event['event_type'] for event in timeline],
            [
                EventType.PRETRIP_INSPECTION,
                EventType.DRIVE,
                EventType.PICKUP,
                EventType.DRIVE,
                EventType.DROPOFF,
                EventType.POSTTRIP_INSPECTION,
            ],
        )

    def test_timeline_events_are_fully_populated(self):
        for event in self.plan().json()['timeline']:
            with self.subTest(sequence=event['sequence']):
                for field in (
                    'start_time', 'end_time', 'duty_status', 'event_type',
                    'location_name', 'latitude', 'longitude', 'reason',
                ):
                    self.assertTrue(event[field], f'{field} is empty')

    def test_summary_reports_the_duty_hour_totals(self):
        summary = self.plan().json()['summary']

        self.assertEqual(summary['event_count'], 6)
        self.assertEqual(summary['driving_hours'], '5.00')
        self.assertEqual(summary['on_duty_hours'], '2.50')
        self.assertEqual(summary['off_duty_hours'], '0.00')
        self.assertEqual(summary['total_elapsed_hours'], '7.50')
        self.assertEqual(summary['total_distance_miles'], '935.00')
        self.assertEqual(summary['total_duration_minutes'], 300)

    def test_route_legs_are_persisted(self):
        self.plan()

        self.assertEqual(RouteLeg.objects.filter(trip=self.trip).count(), 2)

    def test_timeline_events_are_persisted(self):
        self.plan()

        self.assertEqual(TimelineEvent.objects.filter(trip=self.trip).count(), 6)

    def test_trip_status_is_persisted_as_planned(self):
        self.plan()

        self.trip.refresh_from_db()
        self.assertEqual(self.trip.status, TripStatus.PLANNED)

    def test_response_matches_what_the_read_endpoints_subsequently_return(self):
        body = self.plan().json()

        timeline = self.client.get(reverse('trip-timeline', args=[self.trip.id])).json()
        route = self.client.get(reverse('trip-route', args=[self.trip.id])).json()

        self.assertEqual(body['timeline'], timeline)
        self.assertEqual(body['route'], route)

    def test_exhausted_cycle_includes_the_restart_in_the_response(self):
        trip = self.make_trip(cycle_hours_used='70.00')
        url = reverse('trip-plan', args=[trip.id])

        body = self.plan(url=url).json()

        self.assertEqual(body['timeline'][0]['event_type'], EventType.CYCLE_RESTART_34)
        self.assertEqual(body['summary']['off_duty_hours'], '34.00')

    def test_replanning_replaces_rather_than_duplicates(self):
        self.plan()
        body = self.plan().json()

        self.assertEqual(len(body['timeline']), 6)
        self.assertEqual(len(body['route']), 2)
        self.assertEqual(TimelineEvent.objects.filter(trip=self.trip).count(), 6)
        self.assertEqual(RouteLeg.objects.filter(trip=self.trip).count(), 2)


class PlanEndpointFailureTests(PlanEndpointTestCase):
    def test_unplannable_trip_returns_422(self):
        # A 20-hour second leg breaches the 14-hour duty window, and no remedy
        # for that is scheduled yet.
        response = self.plan(StubProvider(leg_2_minutes=20 * 60))

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_unplannable_trip_uses_the_error_envelope(self):
        body = self.plan(StubProvider(leg_2_minutes=20 * 60)).json()

        self.assertEqual(set(body), {'error'})
        self.assertEqual(set(body['error']), {'status_code', 'message', 'details'})
        self.assertEqual(body['error']['status_code'], 422)

    def test_unplannable_trip_reports_the_rule_id_and_reason(self):
        body = self.plan(StubProvider(leg_2_minutes=20 * 60)).json()

        self.assertEqual(body['error']['details']['rule_id'], 'BR-2')
        self.assertEqual(body['error']['details']['evaluator'], 'DutyWindowEvaluator')
        self.assertIn('14-hour duty window', body['error']['details']['detail'])
        self.assertIn('14-hour duty window', body['error']['message'])
        self.assertEqual(body['error']['details']['trip_id'], str(self.trip.id))

    def test_unplannable_trip_is_marked_failed_with_no_timeline(self):
        self.plan(StubProvider(leg_2_minutes=20 * 60))

        self.trip.refresh_from_db()
        self.assertEqual(self.trip.status, TripStatus.FAILED)
        self.assertEqual(TimelineEvent.objects.filter(trip=self.trip).count(), 0)

    def test_failure_response_never_contains_a_traceback(self):
        raw = self.plan(StubProvider(leg_2_minutes=20 * 60)).content.decode()

        for leak in ('Traceback', 'File "', 'apps/planning', 'apps\\planning'):
            with self.subTest(leak=leak):
                self.assertNotIn(leak, raw)

    def test_geocoding_failure_returns_422(self):
        response = self.plan(StubProvider(raises=GeocodingError('Nowhere, ZZ')))
        body = response.json()

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(body['error']['details']['location'], 'Nowhere, ZZ')

    def test_route_not_found_returns_422(self):
        response = self.plan(StubProvider(raises=RouteNotFoundError('Dallas', 'Honolulu')))
        body = response.json()

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(body['error']['details']['origin'], 'Dallas')
        self.assertEqual(body['error']['details']['destination'], 'Honolulu')

    def test_provider_unavailable_returns_503(self):
        response = self.plan(StubProvider(raises=RoutingProviderUnavailableError('timeout')))

        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertIn('temporarily unavailable', response.json()['error']['message'])

    def test_misconfiguration_returns_500_without_leaking_details(self):
        response = self.plan(StubProvider(raises=RoutingConfigurationError('OPENROUTESERVICE_API_KEY missing')))
        body = response.json()

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertNotIn('OPENROUTESERVICE_API_KEY', response.content.decode())
        self.assertEqual(body['error']['message'], 'The routing provider is not configured correctly.')

    def test_unclassified_routing_error_returns_502(self):
        response = self.plan(StubProvider(raises=RoutingError('something odd')))

        self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)
        self.assertNotIn('something odd', response.content.decode())

    def test_a_routing_failure_leaves_no_partial_route(self):
        self.plan(StubProvider(raises=RouteNotFoundError('Dallas', 'Honolulu')))

        self.assertEqual(RouteLeg.objects.filter(trip=self.trip).count(), 0)
        self.assertEqual(TimelineEvent.objects.filter(trip=self.trip).count(), 0)


class PlanEndpointContractTests(PlanEndpointTestCase):
    def test_unknown_trip_returns_404_in_the_envelope(self):
        url = reverse('trip-plan', args=['68972e75-1f1e-46af-8329-19c48b0d7e2c'])

        response = self.plan(url=url)
        body = response.json()

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(body['error']['status_code'], 404)

    def test_get_is_not_allowed(self):
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertEqual(response.json()['error']['status_code'], 405)

    def test_no_request_body_is_required(self):
        # Everything the plan depends on already lives on the Trip row.
        with patch(
            'apps.planning.views.TripPlanningService', service_factory(StubProvider())
        ):
            response = self.client.post(self.url, data={}, content_type='application/json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
