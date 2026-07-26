from rest_framework import serializers

from apps.planning.models import RouteLeg, TimelineEvent, Trip


class TripSerializer(serializers.ModelSerializer):
    class Meta:
        model = Trip
        fields = [
            'id',
            'current_location_text',
            'pickup_location_text',
            'dropoff_location_text',
            'cycle_hours_used',
            'trip_start_time',
            'status',
            'total_distance_miles',
            'total_duration_minutes',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_cycle_hours_used(self, value):
        if value < 0:
            raise serializers.ValidationError('Cycle hours used cannot be negative.')
        return value


class RouteLegSerializer(serializers.ModelSerializer):
    class Meta:
        model = RouteLeg
        fields = [
            'id',
            'trip',
            'sequence',
            'leg_type',
            'origin_text',
            'destination_text',
            'distance_miles',
            'duration_minutes',
            'encoded_polyline',
        ]
        read_only_fields = fields


class TimelineEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = TimelineEvent
        fields = [
            'id',
            'trip',
            'sequence',
            'start_time',
            'end_time',
            'duty_status',
            'event_type',
            'location_name',
            'latitude',
            'longitude',
            'distance_miles',
            'reason',
        ]
        read_only_fields = fields


class TripPlanSummarySerializer(serializers.Serializer):
    """Headline metrics for one planning run.

    Read-only and output-only: this shape is never accepted as input, so it
    declares no `create`/`update`. The duty-hour totals come from the
    in-memory TripPlanningResult (they have no columns — TripSummary is a
    read projection, domain-analysis.md §3.9); the route totals are read off
    the Trip, where RoutingService persisted them.
    """

    event_count = serializers.IntegerField(read_only=True)
    driving_hours = serializers.DecimalField(max_digits=8, decimal_places=2, read_only=True)
    on_duty_hours = serializers.DecimalField(max_digits=8, decimal_places=2, read_only=True)
    off_duty_hours = serializers.DecimalField(max_digits=8, decimal_places=2, read_only=True)
    total_elapsed_hours = serializers.DecimalField(max_digits=8, decimal_places=2, read_only=True)
    total_distance_miles = serializers.DecimalField(
        max_digits=8, decimal_places=2, read_only=True, allow_null=True,
        source='trip.total_distance_miles',
    )
    total_duration_minutes = serializers.IntegerField(
        read_only=True, allow_null=True, source='trip.total_duration_minutes',
    )


class TripPlanSerializer(serializers.Serializer):
    """The complete result of `POST /api/trips/{id}/plan/`.

    A composite read serializer over a TripPlanningResult: it reuses the
    existing Trip/RouteLeg/TimelineEvent serializers rather than restating
    their fields, so the nested shapes stay identical to what
    `GET /trips/{id}/`, `.../route/` and `.../timeline/` already return.

    Route and timeline are read through the Trip's related managers, i.e.
    from what was actually committed — not from the engine's in-memory
    objects. A client therefore sees exactly what a subsequent GET will
    return, and both collections arrive in `sequence` order via each model's
    Meta.ordering.
    """

    planning_status = serializers.CharField(source='trip.status', read_only=True)
    trip = TripSerializer(read_only=True)
    route = RouteLegSerializer(many=True, read_only=True, source='trip.route_legs')
    timeline = TimelineEventSerializer(many=True, read_only=True, source='trip.timeline_events')
    summary = TripPlanSummarySerializer(source='*', read_only=True)
