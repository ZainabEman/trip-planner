"""PlanningEngine — the single entry point into the HOS planning pipeline.

An **iterative scheduler**, not a single pass over legs. The engine walks a
queue of `PlannerAction`s against a `PlanningCursor` that carries the clock,
the route position and the accumulating timeline. Each turn of the loop takes
the next action, evaluates it if it consumes driving time, advances the cursor,
and continues until the destination is reached or planning pauses.

    while not cursor.destination_reached:
        action = next action for the cursor
        if action consumes driving time:
            evaluate against the current clocks
            if blocked: record the pause and stop
        emit the event and advance the cursor

No recursion, and one place where each kind of event is emitted.

The trip is no longer assumed to fit in a single duty window: the cursor tracks
cycle hours and elapsed time across the whole run, and the finished timeline is
grouped into `PlanningDay`s so a multi-day schedule is representable.

Behaviour this phase deliberately leaves unchanged:

* **A blocked leg still yields no events.** The engine records a `PlanningPause`
  describing where it stopped and how much of the leg remains, but returns an
  empty timeline — emitting a plan that stops short of the delivery would break
  FR-4.5 and BR-37. Phase 12B turns that pause into an inserted remedy.
* **One evaluation per leg, first block wins by priority.** Splitting a leg into
  several evaluated increments changes which rule binds first, so it waits for
  12B's nearest-binding-constraint work.
* **The pre-flight 34-hour restart** remains the only remedy scheduled.

A successful plan produces a contiguous, gap-free timeline spanning trip start
to delivery completion exactly (FR-4.1, FR-4.5):

    Pre-Trip Inspection (BR-21, opens the 14h window per BR-24)
      -> Driving        (leg 1)
      -> Pickup         (BR-17, 1 h On Duty)
      -> Driving        (leg 2)
      -> Dropoff        (BR-18, 1 h On Duty)
      -> Post-Trip Inspection (BR-22, closes the duty period)

with a Cycle Restart (34-hr) plus its own Pre-Trip Inspection prepended when the
cycle arrives exhausted. Every event is built by EventFactory and numbered by
TimelineBuilder; this module constructs neither an EngineEvent nor a sequence
number itself, and every clock movement goes through `PlanningCursor.advance`.
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
from apps.planning.services.hos.cursor import PlannerAction, PlanningCursor, group_into_days
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
        """Plan one trip by walking actions against a cursor until done.

        The cursor holds every piece of state the run needs; this method only
        decides which action comes next and reacts to the evaluators.
        """
        cursor = PlanningCursor(
            trip_start_time=context.trip_start_time,
            cycle_hours_used=context.cycle_hours_used,
            leg_count=len(context.route_legs),
        )

        self._open_first_duty_period(context, cursor)

        # ---- the planning loop ----------------------------------------
        # One turn per remaining leg today, because a leg is still the finest
        # driving increment. The loop is written against the cursor rather than
        # an index so 12B can push remedy actions into the same run without
        # restructuring it.
        while not cursor.destination_reached and not cursor.paused:
            leg = context.route_legs[cursor.leg_index]

            # DRIVING is the only action that consumes driving time, so it is
            # the only one the rules gate.
            blocking = self._evaluate_driving(cursor, leg)
            if blocking is not None:
                cursor.record_pause(
                    leg_sequence=leg.sequence,
                    blocking=blocking,
                    leg_duration_minutes=leg.duration_minutes,
                    leg_distance_miles=leg.distance_miles,
                )
                break

            self._perform_driving(cursor, leg)
            self._perform_arrival(context, cursor, leg)
            cursor.complete_leg()

        # A pause means no legal continuation exists for a remedy this phase
        # can schedule, so the events accumulated so far describe an incomplete
        # trip. Returning them would be a partial plan that stops short of the
        # delivery, which BR-37/NFR-2.4 forbid and which would break the
        # Timeline's "spans trip start to delivery completion exactly"
        # invariant (FR-4.5). The RuleResults and the pause still explain why.
        events: tuple = () if cursor.paused else tuple(cursor.timeline.build())

        return PlanningResult(
            context=context,
            events=events,
            rule_results=tuple(cursor.rule_results),
            days=group_into_days(events),
            pause=cursor.pause,
        )

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------

    def _open_first_duty_period(self, context: PlanningContext, cursor: PlanningCursor) -> None:
        """Start the trip: a pre-flight restart if the cycle is exhausted,
        otherwise the pre-trip inspection that opens the first duty period.

        A restart emits its own inspection, so only one of the two paths runs.
        """
        if self._apply_preflight_restart(context, cursor):
            return

        # Open the first duty period (BR-21). The 14-hour window opens at the
        # start of this inspection, not at the first driving minute (BR-24).
        self._emit_pretrip_inspection(context, cursor)

    def _evaluate_driving(
        self, cursor: PlanningCursor, leg: RouteLegInput
    ) -> RuleResult | None:
        """Ask the rules whether the next driving increment is allowed.

        Records every result produced onto the cursor and returns the blocking
        one, or None. One evaluation per leg, first block wins by priority —
        unchanged, because splitting a leg into several evaluated increments
        would change which rule binds first.
        """
        eval_context = EvaluationContext(
            cumulative_driving_hours=cursor.clocks.driving_hours,
            elapsed_duty_window_hours=cursor.clocks.duty_window_hours,
            proposed_driving_hours=leg.duration_hours,
            cumulative_distance_miles=cursor.clocks.distance_miles,
            proposed_distance_miles=leg.distance_miles,
            cumulative_cycle_hours=cursor.clocks.cycle_hours,
        )
        results, blocking = self._run_evaluators(eval_context)
        cursor.rule_results.extend(results)
        return blocking

    def _perform_driving(self, cursor: PlanningCursor, leg: RouteLegInput) -> None:
        """Emit the leg's Driving event and advance the cursor by it."""
        self._emit_driving(leg, cursor)

    def _perform_arrival(
        self, context: PlanningContext, cursor: PlanningCursor, leg: RouteLegInput
    ) -> None:
        """Emit the on-duty work waiting at the end of the current leg.

        The final leg ends at the delivery; every earlier one ends at a pickup
        (BR-17/BR-18). Expressed by cursor position rather than by hardcoding
        "leg 2" so the loop stays correct for the single-leg contexts the test
        suite also exercises.
        """
        self._emit_arrival(context, cursor, leg, is_final=cursor.is_final_leg)

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

    def _emit_pretrip_inspection(self, context: PlanningContext, cursor: PlanningCursor) -> None:
        """Open a duty period with a 15-minute pre-trip inspection (BR-21).

        Placed at the trip's start location. Because this is the timeline's
        first event, its start time *is* the trip start time, and the
        14-hour duty window opens here rather than at the first driving
        minute (BR-24).
        """
        origin = context.route_legs[0]
        start = cursor.current_time
        end = start + self._duration(PRETRIP_INSPECTION_HOURS)
        cursor.timeline.add_event(
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
        cursor.advance(PlannerAction.PRETRIP, PRETRIP_INSPECTION_HOURS)

    def _emit_driving(self, leg: RouteLegInput, cursor: PlanningCursor) -> None:
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
            # EC-1: a same-location hop passes no time and moves no clock.
            return

        start = cursor.current_time
        end = start + timedelta(minutes=leg.duration_minutes)
        cursor.timeline.add_event(
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
        # Driving accrues against the driving clock, the duty window and the
        # cycle at once — advance() is what keeps them from diverging.
        cursor.advance_minutes(
            PlannerAction.DRIVING,
            leg.duration_minutes,
            distance_miles=leg.distance_miles,
            counts_as_driving=True,
        )

    def _emit_arrival(
        self,
        context: PlanningContext,
        cursor: PlanningCursor,
        leg: RouteLegInput,
        is_final: bool,
    ) -> None:
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
        start = cursor.current_time

        if not is_final:
            end = start + self._duration(PICKUP_HOURS)
            cursor.timeline.add_event(
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
            cursor.advance(PlannerAction.PICKUP, PICKUP_HOURS)
            return

        dropoff_end = start + self._duration(DROPOFF_HOURS)
        cursor.timeline.add_event(
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
        cursor.advance(PlannerAction.DROPOFF, DROPOFF_HOURS)

        posttrip_end = dropoff_end + self._duration(POSTTRIP_INSPECTION_HOURS)
        cursor.timeline.add_event(
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
        cursor.advance(PlannerAction.POSTTRIP, POSTTRIP_INSPECTION_HOURS)

    def _apply_preflight_restart(
        self, context: PlanningContext, cursor: PlanningCursor
    ) -> bool:
        """Insert a 34-hour restart before any driving if the cycle is
        already exhausted at trip start (BR-8/BR-10, AC-11, EC-4/EC-44).

        Returns True when a restart was inserted — in which case it has also
        emitted the pre-trip inspection that opens the duty period after it,
        and advanced the cursor past both. False is the overwhelmingly common
        case, and leaves the cursor untouched.

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
            cumulative_cycle_hours=cursor.clocks.cycle_hours,
        )
        _, blocking_result = self._run_evaluators(probe)

        if blocking_result is None or blocking_result.required_action is not RequiredAction.RESTART_34:
            return False

        # Only the blocking result is recorded: the probe's allowed results are
        # a guard, not part of the per-leg audit trail.
        cursor.rule_results.append(blocking_result)

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
        current_time = cursor.current_time
        restart_end = current_time + timedelta(minutes=int(CYCLE_RESTART_HOURS * MINUTES_PER_HOUR))
        cursor.timeline.add_event(
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
        # 34 hours off duty: time passes, but no duty or cycle hours accrue,
        # and the restart clears the cycle entirely (BR-10).
        cursor.advance(
            PlannerAction.CYCLE_RESTART, CYCLE_RESTART_HOURS, counts_as_on_duty=False
        )
        cursor.reset_cycle()
        cursor.open_new_duty_period()

        inspection_end = restart_end + timedelta(
            minutes=int(PRETRIP_INSPECTION_HOURS * MINUTES_PER_HOUR)
        )
        cursor.timeline.add_event(
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
        # The inspection that follows is on-duty time, so it immediately
        # accrues against the fresh cycle total (BR-8) and against the duty
        # window it just opened (BR-24).
        cursor.advance(PlannerAction.PRETRIP, PRETRIP_INSPECTION_HOURS)
        return True
