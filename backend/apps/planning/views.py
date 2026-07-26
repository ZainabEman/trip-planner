from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.planning.models import Trip
from apps.planning.serializers import RouteLegSerializer, TimelineEventSerializer, TripSerializer


class TripViewSet(viewsets.ModelViewSet):
    """CRUD for Trip, plus read-only nested access to its stored route and timeline.

    No generation, no HOS logic — timeline/route reflect exactly what is
    already persisted (empty arrays if nothing has been stored yet).
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
