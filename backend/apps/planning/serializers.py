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
