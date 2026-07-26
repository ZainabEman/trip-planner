from django.db import models


class TripStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    PLANNED = 'planned', 'Planned'
    FAILED = 'failed', 'Failed'


class LegType(models.TextChoices):
    DEADHEAD = 'deadhead', 'Deadhead'
    LOADED = 'loaded', 'Loaded'


class DutyStatus(models.TextChoices):
    OFF_DUTY = 'off_duty', 'Off Duty'
    SLEEPER_BERTH = 'sleeper_berth', 'Sleeper Berth'
    DRIVING = 'driving', 'Driving'
    ON_DUTY_NOT_DRIVING = 'on_duty_not_driving', 'On Duty (Not Driving)'


class EventType(models.TextChoices):
    DRIVE = 'drive', 'Drive'
    PICKUP = 'pickup', 'Pickup'
    DROPOFF = 'dropoff', 'Dropoff'
    FUEL = 'fuel', 'Fuel'
    REST_BREAK_30 = 'rest_break_30', 'Rest Break (30-min)'
    DAILY_REST_10 = 'daily_rest_10', 'Daily Rest (10-hr)'
    CYCLE_RESTART_34 = 'cycle_restart_34', 'Cycle Restart (34-hr)'
    PRETRIP_INSPECTION = 'pretrip_inspection', 'Pre-Trip Inspection'
    POSTTRIP_INSPECTION = 'posttrip_inspection', 'Post-Trip Inspection'
