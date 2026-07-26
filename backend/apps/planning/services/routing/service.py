"""RoutingService — the only entry point views/serializers should use.

Responsibilities: call the configured RoutingProvider, validate what it
returns, and persist the result as RouteLeg rows + Trip totals. No HOS
logic, no timeline construction — those belong to a later phase.
"""
import logging

from django.db import transaction

from apps.planning.choices import LegType
from apps.planning.models import RouteLeg, Trip
from apps.planning.services.routing.base import RoutingProvider
from apps.planning.services.routing.exceptions import RouteNotFoundError, RoutingError
from apps.planning.services.routing.models import RouteResult
from apps.planning.services.routing.openrouteservice import OpenRouteServiceProvider

logger = logging.getLogger(__name__)

# BR-23: the trip route is always exactly two points in sequence —
# current→pickup (deadhead) then pickup→dropoff (loaded).
_LEG_TYPE_BY_SEQUENCE = {1: LegType.DEADHEAD, 2: LegType.LOADED}


class RoutingService:
    def __init__(self, provider: RoutingProvider | None = None):
        self._provider = provider or OpenRouteServiceProvider()

    def plan_route_for_trip(self, trip: Trip) -> RouteResult:
        """Geocode a Trip's three locations, compute its route, and persist it.

        Raises RoutingError (or a subclass) on any failure — nothing is
        partially persisted if the call fails partway through.
        """
        try:
            current = self._provider.geocode(trip.current_location_text)
            pickup = self._provider.geocode(trip.pickup_location_text)
            dropoff = self._provider.geocode(trip.dropoff_location_text)
            result = self._provider.calculate_route(current, pickup, dropoff)
        except RoutingError:
            logger.exception('Routing failed for trip %s', trip.id)
            raise

        self._validate(result)
        self._persist(trip, result)
        return result

    @staticmethod
    def _validate(result: RouteResult) -> None:
        """Guard against a provider returning a structurally empty result."""
        if not result.legs:
            raise RouteNotFoundError('trip start', 'delivery')

    @transaction.atomic
    def _persist(self, trip: Trip, result: RouteResult) -> None:
        # Re-planning a trip replaces its route legs atomically rather than
        # editing them in place — trips are regenerated, not edited (A-24).
        trip.route_legs.all().delete()

        for leg in result.legs:
            RouteLeg.objects.create(
                trip=trip,
                sequence=leg.sequence,
                leg_type=_LEG_TYPE_BY_SEQUENCE[leg.sequence],
                origin_text=leg.origin.resolved_name,
                destination_text=leg.destination.resolved_name,
                distance_miles=leg.distance_miles,
                duration_minutes=leg.duration_minutes,
                encoded_polyline=leg.encoded_polyline,
            )

        trip.total_distance_miles = result.total_distance_miles
        trip.total_duration_minutes = result.total_duration_minutes
        trip.save(update_fields=['total_distance_miles', 'total_duration_minutes', 'updated_at'])
