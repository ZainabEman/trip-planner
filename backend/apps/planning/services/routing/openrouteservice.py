"""RoutingProvider implementation backed by openrouteservice.org.

All openrouteservice-specific request/response shapes are isolated to this
module. Nothing outside it should know these endpoints, headers, or JSON
shapes exist — that is the entire point of the RoutingProvider interface.
"""
import logging
from decimal import Decimal
from typing import Any

import requests
from django.conf import settings

from apps.planning.services.routing.base import RoutingProvider
from apps.planning.services.routing.exceptions import (
    GeocodingError,
    RouteNotFoundError,
    RoutingConfigurationError,
    RoutingProviderUnavailableError,
)
from apps.planning.services.routing.models import GeocodedLocation, RouteLegResult, RouteResult

logger = logging.getLogger(__name__)

METERS_PER_MILE = Decimal('1609.344')
DRIVING_PROFILE = 'driving-car'

# How far the router may search for a road to start/end a leg on.
#
# openrouteservice defaults to 350 m, which geocoded centroids routinely fall
# outside: /geocode/search returns the centroid of a place's polygon, and for
# many places — Oklahoma City, OK and San Antonio, TX among them — that point
# sits further than 350 m from any road in the OSM graph. The directions call
# then returns HTTP 404 with error code 2010 ("Could not find routable point
# within a radius of 350.0 meters"), which carries no `routes` key and so
# surfaces to the user as "no drivable route" for a place that is perfectly
# drivable.
#
# Bounded at 5 km rather than -1 (unlimited) on purpose: a genuinely
# unroutable coordinate — mid-ocean, or off the road network entirely — must
# still fail with RouteNotFoundError rather than silently snapping to some
# arbitrarily distant road. The trade-off is that a leg's endpoints are the
# *snapped* positions, so reported mileage can differ from a door-to-door
# figure by up to this radius (consistent with Assumption A-19: the engine
# works with routed positions, not real street addresses).
SNAP_RADIUS_METERS = 5000

# Status codes worth one retry before giving up: rate limits and transient server errors.
_TRANSIENT_STATUS_CODES = frozenset({403, 429, 500, 502, 503, 504})


class OpenRouteServiceProvider(RoutingProvider):
    """Geocodes and routes via openrouteservice.org's free-tier REST API."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float | None = None,
        max_retries: int = 1,
    ):
        self._api_key = api_key if api_key is not None else settings.OPENROUTESERVICE_API_KEY
        self._base_url = (base_url or settings.OPENROUTESERVICE_BASE_URL).rstrip('/')
        self._timeout = timeout if timeout is not None else settings.ROUTING_REQUEST_TIMEOUT_SECONDS
        self._max_retries = max_retries

    def geocode(self, location: str) -> GeocodedLocation:
        self._require_api_key()

        data = self._request(
            'GET',
            f'{self._base_url}/geocode/search',
            params={'api_key': self._api_key, 'text': location, 'size': 1},
        )

        features = data.get('features') or []
        if not features:
            logger.warning('Geocoding returned no results for %r', location)
            raise GeocodingError(location)

        feature = features[0]
        longitude, latitude = feature['geometry']['coordinates']
        resolved_name = feature.get('properties', {}).get('label', location)

        return GeocodedLocation(
            query=location,
            resolved_name=resolved_name,
            latitude=latitude,
            longitude=longitude,
        )

    def calculate_route(
        self,
        current_location: GeocodedLocation,
        pickup_location: GeocodedLocation,
        dropoff_location: GeocodedLocation,
    ) -> RouteResult:
        self._require_api_key()

        leg1 = self._fetch_leg(sequence=1, origin=current_location, destination=pickup_location)
        leg2 = self._fetch_leg(sequence=2, origin=pickup_location, destination=dropoff_location)
        legs = [leg1, leg2]

        total_distance_miles = sum((leg.distance_miles for leg in legs), Decimal('0.00'))
        total_duration_minutes = sum(leg.duration_minutes for leg in legs)

        return RouteResult(
            legs=legs,
            total_distance_miles=total_distance_miles,
            total_duration_minutes=total_duration_minutes,
        )

    def _fetch_leg(
        self, sequence: int, origin: GeocodedLocation, destination: GeocodedLocation
    ) -> RouteLegResult:
        data = self._request(
            'POST',
            f'{self._base_url}/v2/directions/{DRIVING_PROFILE}',
            json={
                'coordinates': [
                    [origin.longitude, origin.latitude],
                    [destination.longitude, destination.latitude],
                ],
                # One radius per coordinate, as the API requires.
                'radiuses': [SNAP_RADIUS_METERS, SNAP_RADIUS_METERS],
            },
        )

        routes = data.get('routes') or []
        if not routes:
            logger.warning(
                'No drivable route between %r and %r', origin.resolved_name, destination.resolved_name
            )
            raise RouteNotFoundError(origin.resolved_name, destination.resolved_name)

        summary = routes[0].get('summary', {})
        distance_miles = (Decimal(str(summary.get('distance', 0))) / METERS_PER_MILE).quantize(Decimal('0.01'))
        duration_minutes = round(summary.get('duration', 0) / 60)

        return RouteLegResult(
            sequence=sequence,
            origin=origin,
            destination=destination,
            distance_miles=distance_miles,
            duration_minutes=duration_minutes,
            encoded_polyline=routes[0].get('geometry', ''),
        )

    def _require_api_key(self) -> None:
        if not self._api_key:
            raise RoutingConfigurationError(
                'OPENROUTESERVICE_API_KEY is not configured. Set it as an environment variable.'
            )

    def _request(self, method: str, url: str, **kwargs: Any) -> dict:
        """Single retry policy for the whole provider: one retry on timeout,
        connection error, rate limiting, or a 5xx — then a clear exception.
        """
        headers = {'Authorization': self._api_key} if method == 'POST' else {}
        attempts = self._max_retries + 1
        last_error: Exception | str | None = None

        for attempt in range(1, attempts + 1):
            try:
                response = requests.request(method, url, headers=headers, timeout=self._timeout, **kwargs)
            except (requests.Timeout, requests.ConnectionError) as exc:
                last_error = exc
                logger.warning('Routing provider request failed (attempt %s/%s): %s', attempt, attempts, exc)
                continue

            if response.status_code == 401:
                raise RoutingConfigurationError('Routing provider rejected the API key.')

            if response.status_code in _TRANSIENT_STATUS_CODES:
                last_error = f'HTTP {response.status_code}'
                logger.warning(
                    'Routing provider returned %s (attempt %s/%s)', last_error, attempt, attempts
                )
                continue

            if response.status_code >= 400:
                # A non-transient 4xx (malformed input, no routable point, etc.) is
                # not "unavailable" — treat it as "no result" and let the caller
                # (geocode/calculate_route) raise the appropriate domain error.
                return {}

            return response.json()

        logger.error('Routing provider unavailable after %s attempt(s): %s', attempts, last_error)
        raise RoutingProviderUnavailableError(
            f'Routing provider unavailable: {last_error}' if last_error else 'Routing provider unavailable.'
        )
