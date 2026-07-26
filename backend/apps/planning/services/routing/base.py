"""Abstract routing provider interface.

Any routing/geocoding vendor is implemented by satisfying this interface,
so RoutingService (and everything above it) never depends on a specific
vendor's request/response shape. Swapping providers means writing a new
class here — nothing else changes (NFR-5.3).
"""
from abc import ABC, abstractmethod

from apps.planning.services.routing.models import GeocodedLocation, RouteResult


class RoutingProvider(ABC):
    @abstractmethod
    def geocode(self, location: str) -> GeocodedLocation:
        """Resolve a free-text location to coordinates.

        Raises GeocodingError if the location cannot be resolved.
        Raises RoutingProviderUnavailableError if the provider itself fails.
        """
        raise NotImplementedError

    @abstractmethod
    def calculate_route(
        self,
        current_location: GeocodedLocation,
        pickup_location: GeocodedLocation,
        dropoff_location: GeocodedLocation,
    ) -> RouteResult:
        """Compute the two-leg route: current→pickup, pickup→dropoff.

        Raises RouteNotFoundError if no drivable route exists for either leg.
        Raises RoutingProviderUnavailableError if the provider itself fails.
        """
        raise NotImplementedError
