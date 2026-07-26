"""EventFactory — the only place EngineEvent instances are constructed.

No calculations happen here. Callers (a future RuleEvaluator/PlanningEngine)
must supply already-computed values — start/end times, distances,
coordinates. This class only assembles them into a well-formed EngineEvent.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from apps.planning.choices import DutyStatus, EventType
from apps.planning.services.hos.models import EngineEvent


class EventFactory:
    @staticmethod
    def create_event(
        start_time: datetime,
        end_time: datetime,
        duty_status: DutyStatus,
        event_type: EventType,
        location_name: str,
        latitude: float,
        longitude: float,
        reason: str,
        distance_miles: Decimal | None = None,
    ) -> EngineEvent:
        """Assemble an EngineEvent from already-computed values.

        `sequence` is intentionally left unset — TimelineBuilder assigns it
        once the final chronological order is known.
        """
        return EngineEvent(
            sequence=None,
            start_time=start_time,
            end_time=end_time,
            duty_status=duty_status,
            event_type=event_type,
            location_name=location_name,
            latitude=latitude,
            longitude=longitude,
            reason=reason,
            distance_miles=distance_miles,
        )
