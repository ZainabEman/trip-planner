import uuid

from django.db import models

from apps.planning.choices import DutyStatus, EventType, LegType, TripStatus


class Trip(models.Model):
    """The aggregate root: one planning request and its persisted result."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    current_location_text = models.CharField(max_length=255)
    pickup_location_text = models.CharField(max_length=255)
    dropoff_location_text = models.CharField(max_length=255)

    cycle_hours_used = models.DecimalField(max_digits=5, decimal_places=2)
    trip_start_time = models.DateTimeField()

    status = models.CharField(
        max_length=20,
        choices=TripStatus.choices,
        default=TripStatus.PENDING,
    )

    total_distance_miles = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True
    )
    total_duration_minutes = models.PositiveIntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['created_at']),
            models.Index(fields=['status']),
            models.Index(fields=['trip_start_time']),
        ]

    def __str__(self):
        return f'Trip {self.id} ({self.pickup_location_text} → {self.dropoff_location_text})'


class RouteLeg(models.Model):
    """One segment of a Trip's route: current→pickup or pickup→dropoff."""

    trip = models.ForeignKey(Trip, on_delete=models.CASCADE, related_name='route_legs')

    sequence = models.PositiveSmallIntegerField()
    leg_type = models.CharField(max_length=20, choices=LegType.choices)

    origin_text = models.CharField(max_length=255)
    destination_text = models.CharField(max_length=255)

    distance_miles = models.DecimalField(max_digits=8, decimal_places=2)
    duration_minutes = models.PositiveIntegerField()

    encoded_polyline = models.TextField()

    class Meta:
        ordering = ['sequence']
        constraints = [
            models.UniqueConstraint(fields=['trip', 'sequence'], name='unique_trip_leg_sequence'),
        ]

    def __str__(self):
        return f'RouteLeg {self.sequence} of {self.trip_id} ({self.origin_text} → {self.destination_text})'


class TimelineEvent(models.Model):
    """One contiguous block of a single duty status within a Trip's Timeline."""

    trip = models.ForeignKey(Trip, on_delete=models.CASCADE, related_name='timeline_events')

    sequence = models.PositiveIntegerField()

    start_time = models.DateTimeField()
    end_time = models.DateTimeField()

    duty_status = models.CharField(max_length=25, choices=DutyStatus.choices)
    event_type = models.CharField(max_length=25, choices=EventType.choices)

    location_name = models.CharField(max_length=255)
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)

    distance_miles = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)

    reason = models.TextField()

    class Meta:
        ordering = ['sequence']
        constraints = [
            models.UniqueConstraint(fields=['trip', 'sequence'], name='unique_trip_event_sequence'),
        ]

    def __str__(self):
        return f'TimelineEvent {self.sequence} of {self.trip_id} ({self.event_type})'
