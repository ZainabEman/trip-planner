"""PlanningEngine — the single entry point into the HOS planning pipeline.

Executes the registered RuleEvaluators (in priority order) against each
RouteLeg's driving demand in turn, accumulating cumulative driving hours,
elapsed duty-window hours, cumulative distance, and cumulative cycle
hours as it goes. As soon as any evaluator blocks a leg, the engine stops
processing further legs — no remedy is scheduled *mid-trip* yet, so
halting remains the only correct behavior there.

The one exception, and the only remedy this phase schedules, is the
**pre-flight** 34-hour restart: a driver who arrives with an already
exhausted 70-hour cycle (BR-8) needs a restart before any driving is
attempted, and that restart sits at the trip's start location on the
trip's start time, so it needs neither route-geometry interpolation nor
mid-leg splitting to place. See `_apply_preflight_restart`.

A successful plan produces a contiguous, gap-free timeline spanning trip
start to delivery completion exactly (FR-4.1, FR-4.5):

    Pre-Trip Inspection (BR-21, opens the 14h window per BR-24)
      -> Driving        (leg 1)
      -> Pickup         (BR-17, 1 h On Duty)
      -> Driving        (leg 2)
      -> Dropoff        (BR-18, 1 h On Duty)
      -> Post-Trip Inspection (BR-22, closes the duty period)

with a Cycle Restart (34-hr) plus its own Pre-Trip Inspection prepended
when the cycle arrives exhausted. Every event is built by EventFactory and
numbered by TimelineBuilder; this module constructs neither an EngineEvent
nor a sequence number itself.

If any leg is blocked, the engine returns **no events at all** rather than
a timeline that stops short of the delivery — see `plan`.

Deliberately still absent (each belongs to a later phase, not here):

* **Mid-trip remedies** — the 30-minute break, 10-hour reset, fuel stop,
  and mid-trip restart. Evaluators already detect and name all four via
  `RuleResult.required_action`; nothing schedules them yet, so a leg that
  needs one is reported as unplannable rather than silently mis-planned.
* **Mid-leg event placement (BR-36).** One Driving event per leg is the
  finest granularity available: splitting a leg at an arbitrary mileage
  needs route geometry `RouteLegInput` does not carry (it has endpoints
  only), so a rule boundary cannot yet be resolved to a place name.
* **Nearest-binding-constraint selection.** The evaluator loop still
  returns on the first block by priority. Safe while the only remedy
  scheduled is the pre-flight one — evaluated before any clock but the
  cycle has advanced, so no other rule can be binding at that moment.
* **StateMachine** remains unused; the Timeline is the single record of
  duty-status transitions (domain-analysis.md §3.4).
"""
from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from apps.planning.choices import DutyStatus, EventType
from apps.planning.services.hos.constants import (
    CYCLE_RESTART_HOURS,
    DROPOFF_HOURS,
    PICKUP_HOURS,
    POSTTRIP_INSPECTION_HOURS,
    PRETRIP_INSPECTION_HOURS,
)
from apps.planning.services.hos.evaluators.base import RuleEvaluator
from apps.planning.services.hos.event_factory import EventFactory
from apps.planning.services.hos.models import (
    MINUTES_PER_HOUR,
    EvaluationContext,
    PlanningContext,
    PlanningResult,
    RequiredAction,
    RouteLegInput,
    RuleResult,
)
from apps.planning.services.hos.timeline_builder import TimelineBuilder


class PlanningEngine:
    """Coordinates registered RuleEvaluators over a Trip's route legs.

    No rule logic lives here — this class only sequences calls to the
    evaluators, in priority order, stops on the first block, and schedules
    the remedy an evaluator asked for via `RuleResult.required_action`.
    Which 70-hour threshold counts as "exhausted" is CycleLimitEvaluator's
    business, not this class's; the engine only recognises the
    `RESTART_34` action that evaluator reports.
    """

    def __init__(self, evaluators: list[RuleEvaluator] | None = None) -> None:
        self._evaluators = sorted(evaluators or [], key=lambda evaluator: evaluator.priority())

    def plan(self, context: PlanningContext) -> PlanningResult:
        current_time = context.trip_start_time
        cumulative_driving_hours = Decimal('0')
        elapsed_duty_window_hours = Decimal('0')
        cumulative_distance_miles = Decimal('0')
        cumulative_cycle_hours = context.cycle_hours_used
        rule_results: list[RuleResult] = []
        timeline = TimelineBuilder()

        preflight = self._apply_preflight_restart(context, timeline, current_time, cumulative_cycle_hours)
        if preflight is not None:
            current_time, cumulative_cycle_hours, elapsed_duty_window_hours, blocking_result = preflight
            rule_results.append(blocking_result)
        else:
            # Open the first duty period (BR-21). When a pre-flight restart
            # ran it already emitted this inspection for the duty period it
            # opened, so emitting a second one here would double it.
            current_time = self._emit_pretrip_inspection(context, timeline, current_time)
            elapsed_duty_window_hours += PRETRIP_INSPECTION_HOURS  # BR-24
            cumulative_cycle_hours += PRETRIP_INSPECTION_HOURS  # BR-8

        blocked = False
        last_index = len(context.route_legs) - 1

        for index, leg in enumerate(context.route_legs):
            eval_context = EvaluationContext(
                cumulative_driving_hours=cumulative_driving_hours,
                elapsed_duty_window_hours=elapsed_duty_window_hours,
                proposed_driving_hours=leg.duration_hours,
                cumulative_distance_miles=cumulative_distance_miles,
                proposed_distance_miles=leg.distance_miles,
                cumulative_cycle_hours=cumulative_cycle_hours,
            )

            leg_results, blocking_result = self._run_evaluators(eval_context)
            rule_results.extend(leg_results)

            if blocking_result is not None:
                blocked = True
                break

            current_time = self._emit_driving(leg, timeline, current_time)

            cumulative_driving_hours += leg.duration_hours
            elapsed_duty_window_hours += leg.duration_hours
            cumulative_distance_miles += leg.distance_miles
            # Driving is on-duty time, so it accrues against the cycle (BR-8).
            cumulative_cycle_hours += leg.duration_hours

            # The final leg ends at the delivery; every earlier one ends at a
            # pickup (BR-17/BR-18). With BR-23's fixed two-leg route that is
            # leg 1 -> Pickup, leg 2 -> Dropoff, but expressing it by position
            # rather than by hardcoding "leg 2" keeps the loop correct for the
            # single-leg contexts the test suite also exercises.
            current_time, on_duty_hours = self._emit_arrival(
                context, timeline, current_time, leg, is_final=index == last_index
            )
            elapsed_duty_window_hours += on_duty_hours
            cumulative_cycle_hours += on_duty_hours

        # A blocked leg means no legal continuation exists for a remedy this
        # phase can schedule, so the events accumulated so far describe an
        # incomplete trip. Returning them would be a partial plan that stops
        # short of the delivery, which BR-37/NFR-2.4 forbid and which would
        # break the Timeline's "spans trip start to delivery completion
        # exactly" invariant (FR-4.5). The RuleResults still explain why.
        events = () if blocked else tuple(timeline.build())

        return PlanningResult(
            context=context,
            events=events,
            rule_results=tuple(rule_results),
        )

    def _run_evaluators(
        self, eval_context: EvaluationContext
    ) -> tuple[list[RuleResult], RuleResult | None]:
        """Run the registered evaluators in priority order, stopping at the
        first block.

        Returns every result produced plus the blocking one (or None). The
        first-block-wins semantics are unchanged from the previous phase —
        this is only extracted so the pre-flight check and the leg loop
        share one implementation of it rather than two.
        """
        results: list[RuleResult] = []
        for evaluator in self._evaluators:
            result = evaluator.evaluate(eval_context)
            results.append(result)
            if not result.allowed:
                return results, result
        return results, None

    @staticmethod
    def _duration(hours: Decimal) -> timedelta:
        """Convert a Decimal hour count to an exact whole-minute timedelta.

        Every duration in constants.py is an exact multiple of a minute, so
        this never truncates — going via minutes keeps float out of the
        clock arithmetic entirely.
        """
        return timedelta(minutes=int(hours * MINUTES_PER_HOUR))

    def _emit_pretrip_inspection(
        self, context: PlanningContext, timeline: TimelineBuilder, start: datetime
    ) -> datetime:
        """Open a duty period with a 15-minute pre-trip inspection (BR-21).

        Placed at the trip's start location. Because this is the timeline's
        first event, its start time *is* the trip start time, and the
        14-hour duty window opens here rather than at the first driving
        minute (BR-24).
        """
        origin = context.route_legs[0]
        end = start + self._duration(PRETRIP_INSPECTION_HOURS)
        timeline.add_event(
            EventFactory.create_event(
                start_time=start,
                end_time=end,
                duty_status=DutyStatus.ON_DUTY_NOT_DRIVING,
                event_type=EventType.PRETRIP_INSPECTION,
                location_name=context.current_location_text,
                latitude=origin.origin_latitude,
                longitude=origin.origin_longitude,
                reason=(
                    'Pre-trip inspection opening the duty period; the 14-hour duty '
                    'window starts here (BR-21, BR-24).'
                ),
            )
        )
        return end

    def _emit_driving(
        self, leg: RouteLegInput, timeline: TimelineBuilder, start: datetime
    ) -> datetime:
        """Emit one Driving event covering a whole leg.

        One event per leg, not per rule-boundary: splitting a leg at an
        arbitrary mileage needs route geometry `RouteLegInput` does not
        carry, so a leg is still the smallest driving increment the engine
        can express. Located at the leg's origin, because that is where the
        duty-status change happens and therefore where BR-29's log remark
        belongs.

        A zero-duration leg (EC-1, a same-location hop) contributes no
        event at all rather than a zero-length one, per BR-35.
        """
        if leg.duration_minutes == 0:
            return start

        end = start + timedelta(minutes=leg.duration_minutes)
        timeline.add_event(
            EventFactory.create_event(
                start_time=start,
                end_time=end,
                duty_status=DutyStatus.DRIVING,
                event_type=EventType.DRIVE,
                location_name=leg.origin_text,
                latitude=leg.origin_latitude,
                longitude=leg.origin_longitude,
                reason=(
                    f'Driving leg {leg.sequence} from {leg.origin_text} to '
                    f'{leg.destination_text} (BR-13).'
                ),
                distance_miles=leg.distance_miles,
            )
        )
        return end

    def _emit_arrival(
        self,
        context: PlanningContext,
        timeline: TimelineBuilder,
        start: datetime,
        leg: RouteLegInput,
        is_final: bool,
    ) -> tuple[datetime, Decimal]:
        """Emit the on-duty work waiting at the end of a leg.

        Returns the advanced clock and the on-duty hours consumed, which the
        caller accrues against the duty window and the cycle. All events
        here are On Duty (Not Driving) per BR-14.

        The final leg ends at the delivery: one hour of unloading (BR-18)
        followed by the post-trip inspection that closes the duty period
        (BR-22), which is the trip's last event. Every earlier leg ends at
        the pickup: one hour of loading (BR-17).

        Note on ordering: `hos-engine-design.md` §4 step 6.8 lists the
        post-trip inspection *before* the dropoff, while §6.3's worked
        example lists "Post-Trip Inspection, then Dropoff" as a single
        on-duty block. Taken literally the first would close the duty
        period before the work inside it finished, so this implements
        dropoff-then-post-trip, which is what BR-22's own trigger ("end of
        each duty period, last driving segment complete") describes.
        """
        if not is_final:
            end = start + self._duration(PICKUP_HOURS)
            timeline.add_event(
                EventFactory.create_event(
                    start_time=start,
                    end_time=end,
                    duty_status=DutyStatus.ON_DUTY_NOT_DRIVING,
                    event_type=EventType.PICKUP,
                    location_name=context.pickup_location_text,
                    latitude=leg.destination_latitude,
                    longitude=leg.destination_longitude,
                    reason=f'Loading at pickup: {context.pickup_location_text} (BR-17).',
                )
            )
            return end, PICKUP_HOURS

        dropoff_end = start + self._duration(DROPOFF_HOURS)
        timeline.add_event(
            EventFactory.create_event(
                start_time=start,
                end_time=dropoff_end,
                duty_status=DutyStatus.ON_DUTY_NOT_DRIVING,
                event_type=EventType.DROPOFF,
                location_name=context.dropoff_location_text,
                latitude=leg.destination_latitude,
                longitude=leg.destination_longitude,
                reason=f'Unloading at dropoff: {context.dropoff_location_text} (BR-18).',
            )
        )

        posttrip_end = dropoff_end + self._duration(POSTTRIP_INSPECTION_HOURS)
        timeline.add_event(
            EventFactory.create_event(
                start_time=dropoff_end,
                end_time=posttrip_end,
                duty_status=DutyStatus.ON_DUTY_NOT_DRIVING,
                event_type=EventType.POSTTRIP_INSPECTION,
                location_name=context.dropoff_location_text,
                latitude=leg.destination_latitude,
                longitude=leg.destination_longitude,
                reason=(
                    'Post-trip inspection closing the duty period after delivery '
                    '(BR-22).'
                ),
            )
        )
        return posttrip_end, DROPOFF_HOURS + POSTTRIP_INSPECTION_HOURS

    def _apply_preflight_restart(
        self,
        context: PlanningContext,
        timeline: TimelineBuilder,
        current_time: datetime,
        cumulative_cycle_hours: Decimal,
    ) -> tuple[datetime, Decimal, Decimal, RuleResult] | None:
        """Insert a 34-hour restart before any driving if the cycle is
        already exhausted at trip start (BR-8/BR-10, AC-11, EC-4/EC-44).

        Returns the advanced clock, the reset cycle total, the elapsed
        duty-window hours for the newly opened duty period, and the
        RuleResult that triggered the restart — or None if no restart is
        due, which is the overwhelmingly common case.

        The condition is detected by *asking the evaluators*, using a
        zero-hour proposed increment, rather than by restating the 70-hour
        threshold here — that keeps the engine free of rule logic. Only
        CycleLimitEvaluator can block a zero-hour increment (every other
        evaluator allows one, since it consumes no budget), and any block
        that is not a RESTART_34 request is deliberately ignored so this
        guard can never halt a plan the leg loop would otherwise have
        handled.

        **Assumption (approved, and the one this phase makes most
        visible): a 34-hour restart begins a new duty period, and
        therefore emits its own pre-trip inspection.** `hos-engine-design.md`
        records duty-period granularity as the design's most consequential
        open question — BR-21/BR-22 bracket "each duty period" without the
        PRD defining where one ends. This engine resolves it as: any
        qualifying off-duty block of 10 hours or more (so every 10-hour
        reset and every 34-hour restart) closes one duty period and opens
        the next, which gets a fresh 15-minute pre-trip inspection. The
        14-hour window then opens at the *start* of that inspection, not
        at the first driving minute (BR-24).
        """
        probe = EvaluationContext(
            cumulative_driving_hours=Decimal('0'),
            elapsed_duty_window_hours=Decimal('0'),
            proposed_driving_hours=Decimal('0'),
            cumulative_cycle_hours=cumulative_cycle_hours,
        )
        _, blocking_result = self._run_evaluators(probe)

        if blocking_result is None or blocking_result.required_action is not RequiredAction.RESTART_34:
            return None

        # Both events sit at the trip's start location. PlanningContext
        # guarantees at least one leg, and no interpolation is needed
        # because the truck has not moved yet — which is precisely what
        # makes the pre-flight restart placeable without route geometry.
        origin = context.route_legs[0]
        latitude = origin.origin_latitude
        longitude = origin.origin_longitude
        location_name = context.current_location_text

        # Converted to whole minutes so the clock arithmetic stays exact —
        # both durations are exact multiples of a minute by construction.
        restart_end = current_time + timedelta(minutes=int(CYCLE_RESTART_HOURS * MINUTES_PER_HOUR))
        timeline.add_event(
            EventFactory.create_event(
                start_time=current_time,
                end_time=restart_end,
                # Off Duty per A-10's simpler default; sleeper berth is a
                # structurally valid alternative the v1 policy never picks.
                duty_status=DutyStatus.OFF_DUTY,
                event_type=EventType.CYCLE_RESTART_34,
                location_name=location_name,
                latitude=latitude,
                longitude=longitude,
                reason=blocking_result.reason,
            )
        )

        inspection_end = restart_end + timedelta(
            minutes=int(PRETRIP_INSPECTION_HOURS * MINUTES_PER_HOUR)
        )
        timeline.add_event(
            EventFactory.create_event(
                start_time=restart_end,
                end_time=inspection_end,
                duty_status=DutyStatus.ON_DUTY_NOT_DRIVING,
                event_type=EventType.PRETRIP_INSPECTION,
                location_name=location_name,
                latitude=latitude,
                longitude=longitude,
                reason=(
                    'Pre-trip inspection opening the duty period that begins after the '
                    '34-hour cycle restart (BR-21; restart starts a new duty period).'
                ),
            )
        )

        # The restart clears the cycle (BR-10); the inspection that follows
        # is on-duty time, so it immediately accrues against the fresh
        # cycle total (BR-8) and against the duty window it just opened
        # (BR-24).
        return (
            inspection_end,
            PRETRIP_INSPECTION_HOURS,
            PRETRIP_INSPECTION_HOURS,
            blocking_result,
        )
