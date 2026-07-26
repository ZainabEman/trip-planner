from django.contrib import admin

from apps.planning.models import RouteLeg, TimelineEvent, Trip


class RouteLegInline(admin.TabularInline):
    model = RouteLeg
    extra = 0
    ordering = ['sequence']


class TimelineEventInline(admin.TabularInline):
    model = TimelineEvent
    extra = 0
    ordering = ['sequence']


@admin.register(Trip)
class TripAdmin(admin.ModelAdmin):
    list_display = (
        'id',
        'pickup_location_text',
        'dropoff_location_text',
        'status',
        'trip_start_time',
        'created_at',
    )
    list_filter = ('status',)
    search_fields = ('id', 'current_location_text', 'pickup_location_text', 'dropoff_location_text')
    readonly_fields = ('id', 'created_at', 'updated_at')
    inlines = [RouteLegInline, TimelineEventInline]


@admin.register(RouteLeg)
class RouteLegAdmin(admin.ModelAdmin):
    list_display = ('trip', 'sequence', 'leg_type', 'origin_text', 'destination_text', 'distance_miles')
    list_filter = ('leg_type',)
    ordering = ('trip', 'sequence')


@admin.register(TimelineEvent)
class TimelineEventAdmin(admin.ModelAdmin):
    list_display = (
        'trip',
        'sequence',
        'duty_status',
        'event_type',
        'start_time',
        'end_time',
        'location_name',
    )
    list_filter = ('duty_status', 'event_type')
    ordering = ('trip', 'sequence')
