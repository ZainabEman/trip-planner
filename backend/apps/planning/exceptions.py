import logging

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from apps.planning.services.planning_service import TripNotPlannableError
from apps.planning.services.routing.exceptions import (
    GeocodingError,
    RouteNotFoundError,
    RoutingConfigurationError,
    RoutingError,
    RoutingProviderUnavailableError,
)

logger = logging.getLogger(__name__)


def _extract_message(detail):
    if isinstance(detail, dict):
        if list(detail.keys()) == ['detail']:
            return str(detail['detail'])
        return 'One or more fields failed validation.'
    if isinstance(detail, list):
        return ' '.join(str(item) for item in detail)
    return str(detail)


def _map_domain_exception(exc):
    """Translate a service-layer exception into (status_code, message, details).

    Returns None for anything unrecognised, which leaves Django's own 500
    handling in place rather than dressing up an unexpected bug as a handled
    error.

    Kept here, next to the envelope, so the domain services stay free of HTTP
    concerns and views need no try/except of their own — a view raises (or
    lets a service raise) and this is the single place that decides what the
    wire looks like. No exception's traceback is ever serialised; only the
    curated fields below reach the client.
    """
    if isinstance(exc, TripNotPlannableError):
        # The request was well-formed and the Trip exists — the trip simply
        # cannot be driven legally under the implemented rule set. That is
        # semantically unprocessable content, not a malformed request.
        details = {'detail': exc.reason, 'trip_id': str(exc.trip_id)}
        if exc.rule_id is not None:
            details['rule_id'] = exc.rule_id
        if exc.evaluator_name is not None:
            details['evaluator'] = exc.evaluator_name
        return status.HTTP_422_UNPROCESSABLE_ENTITY, exc.reason, details

    if isinstance(exc, GeocodingError):
        # The location text passed field validation but no provider can
        # resolve it, so it is unusable rather than invalid in shape.
        return (
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            str(exc),
            {'detail': str(exc), 'location': exc.location},
        )

    if isinstance(exc, RouteNotFoundError):
        return (
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            str(exc),
            {'detail': str(exc), 'origin': exc.origin, 'destination': exc.destination},
        )

    if isinstance(exc, RoutingProviderUnavailableError):
        message = 'The routing provider is temporarily unavailable. Please try again.'
        return status.HTTP_503_SERVICE_UNAVAILABLE, message, {'detail': message}

    if isinstance(exc, RoutingConfigurationError):
        # A server-side misconfiguration. Log the specifics; return a generic
        # message so provider/credential details never reach a client.
        logger.error('Routing provider misconfigured: %s', exc)
        message = 'The routing provider is not configured correctly.'
        return status.HTTP_500_INTERNAL_SERVER_ERROR, message, {'detail': message}

    if isinstance(exc, RoutingError):
        # Base-class fallback: an upstream failure we have not classified.
        logger.warning('Unclassified routing failure: %s', exc)
        message = 'The routing provider could not complete the request.'
        return status.HTTP_502_BAD_GATEWAY, message, {'detail': message}

    return None


def custom_exception_handler(exc, context):
    """Wraps error handling in a consistent {"error": {...}} envelope.

    Handles both DRF's own exceptions and the service-layer exceptions raised
    by the planning and routing contexts.
    """
    response = drf_exception_handler(exc, context)

    if response is not None:
        status_code = response.status_code
        detail = response.data
        message = _extract_message(detail)
        details = detail if isinstance(detail, dict) else {'detail': detail}
    else:
        mapped = _map_domain_exception(exc)
        if mapped is None:
            return None
        status_code, message, details = mapped
        response = Response(status=status_code)

    response.status_code = status_code
    response.data = {
        'error': {
            'status_code': status_code,
            'message': message,
            'details': details,
        }
    }
    return response
