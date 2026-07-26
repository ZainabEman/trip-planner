"""Provider-agnostic DTOs for the routing layer.

These are plain dataclasses — never Django models. They are the contract
between a RoutingProvider implementation and RoutingService, so that
provider-specific response shapes never leak past `openrouteservice.py`.
"""
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class GeocodedLocation:
    """A user-entered location resolved to coordinates."""

    query: str
    resolved_name: str
    latitude: float
    longitude: float


@dataclass(frozen=True)
class RouteLegResult:
    """One leg of a route, already expressed in the app's units (miles, minutes)."""

    sequence: int
    origin: GeocodedLocation
    destination: GeocodedLocation
    distance_miles: Decimal
    duration_minutes: int
    encoded_polyline: str


@dataclass(frozen=True)
class RouteResult:
    """The complete route: an ordered set of legs plus trip-level aggregates."""

    legs: list[RouteLegResult]
    total_distance_miles: Decimal
    total_duration_minutes: int
