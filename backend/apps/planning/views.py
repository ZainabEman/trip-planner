from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.planning.models import Trip
from apps.planning.serializers import (
    RouteLegSerializer,
    TimelineEventSerializer,
    TripPlanSerializer,
    TripSerializer,
)
from apps.planning.services.planning_service import TripPlanningService


class TripViewSet(viewsets.ModelViewSet):
    """CRUD for Trip, read-only nested access to its route and timeline, and
    the `plan` action that generates both.

    `timeline` and `route` reflect exactly what is already persisted (empty
    arrays if nothing has been stored yet); `plan` is what fills them.
    """

    queryset = Trip.objects.all()
    serializer_class = TripSerializer
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['status']
    ordering_fields = ['created_at', 'trip_start_time', 'status']
    ordering = ['-created_at']

    @action(detail=True, methods=['get'])
    def timeline(self, request, pk=None):
        trip = self.get_object()
        events = trip.timeline_events.all()
        serializer = TimelineEventSerializer(events, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def route(self, request, pk=None):
        trip = self.get_object()
        legs = trip.route_legs.all()
        serializer = RouteLegSerializer(legs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def plan(self, request, pk=None):
        """Generate and persist the complete plan for a Trip.

        Orchestration only: `TripPlanningService.plan_trip` performs the whole
        workflow — it calls RoutingService (which persists the RouteLegs and
        the Trip's route totals), runs the HOS engine over the resulting
        geography, writes the TimelineEvents, and flips the Trip's status —
        all inside its own transaction. Calling RoutingService separately here
        would re-run a paid, rate-limited geocode/route for no gain and
        duplicate a decision the service already owns.

        Takes no request body: everything the plan depends on is already on
        the Trip row. Re-posting regenerates the plan, replacing the previous
        route and timeline (A-24 — trips are regenerated, never edited).

        Failures propagate to `apps.planning.exceptions.custom_exception_handler`,
        which owns the status-code mapping and the error envelope, so no error
        formatting lives here.
        """
        trip = self.get_object()
        result = TripPlanningService().plan_trip(trip)
        return Response(TripPlanSerializer(result).data)
