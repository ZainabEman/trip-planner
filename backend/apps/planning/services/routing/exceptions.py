"""Custom exceptions for the routing layer.

All routing failures raise one of these, never a raw requests/urllib3
exception — callers (RoutingService, and anything above it) should only
ever need to catch RoutingError and its subclasses.
"""


class RoutingError(Exception):
    """Base class for every error the routing layer can raise."""


class RoutingConfigurationError(RoutingError):
    """The routing provider is misconfigured (e.g. missing API key)."""


class GeocodingError(RoutingError):
    """A location string could not be resolved to coordinates."""

    def __init__(self, location: str, message: str | None = None):
        self.location = location
        super().__init__(message or f"Could not resolve location: {location!r}")


class RouteNotFoundError(RoutingError):
    """The provider returned no drivable route between two points."""

    def __init__(self, origin: str, destination: str):
        self.origin = origin
        self.destination = destination
        super().__init__(f"No drivable route found between {origin!r} and {destination!r}")


class RoutingProviderUnavailableError(RoutingError):
    """The provider timed out, rate-limited, or returned a server error."""
