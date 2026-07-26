"""TimelineBuilder — collects, orders, and assembles EngineEvents.

Deliberately dumb: no FMCSA rule decisions happen here. Its only job is
to take whatever events were produced elsewhere, put them in chronological
order, and hand back a numbered, internally-consistent sequence. The one
check it performs (no two events overlap in time) is basic sequence
hygiene, not an HOS rule — it doesn't reference any FMCSA limit or
constant.
"""
from __future__ import annotations

from dataclasses import replace

from apps.planning.services.hos.exceptions import TimelineAssemblyError
from apps.planning.services.hos.models import EngineEvent


class TimelineBuilder:
    def __init__(self) -> None:
        self._events: list[EngineEvent] = []

    def add_event(self, event: EngineEvent) -> None:
        self._events.append(event)

    def build(self) -> list[EngineEvent]:
        """Return the collected events, chronologically ordered and sequenced.

        Raises TimelineAssemblyError if two events overlap in time.
        """
        ordered = sorted(self._events, key=lambda event: event.start_time)
        self._check_no_overlap(ordered)
        return [replace(event, sequence=index + 1) for index, event in enumerate(ordered)]

    @staticmethod
    def _check_no_overlap(ordered_events: list[EngineEvent]) -> None:
        for previous, current in zip(ordered_events, ordered_events[1:]):
            if current.start_time < previous.end_time:
                raise TimelineAssemblyError(
                    f'Event starting at {current.start_time} overlaps the '
                    f'previous event ending at {previous.end_time}.'
                )
