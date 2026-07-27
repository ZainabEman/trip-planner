"""PlanningEngine — the single entry point into the HOS planning pipeline.

A **multi-day scheduler**. The engine walks a `PlanningCursor` along the route,
and when a rule forbids the next stretch of driving it does not give up: it
drives as far as the rule allows, inserts the remedy that rule named, resets the
clocks the remedy clears, and resumes from exactly where it stopped.

    while destination not reached:
        offer the rest of the current leg to the rules
        if every rule allows it:
            drive it, do the work waiting at the end, move to the next leg
        else:
            pick the constraint that binds *soonest*
            drive as far as that constraint permits
            insert its remedy, reset what the remedy clears, resume

Failure is now a genuinely exceptional outcome. A trip fails only when the
binding rule names no remedy the engine can schedule, or when scheduling one
moves nothing — not merely because some rule blocked. Rules block constantly on
a legal multi-day plan; that is what a break *is*.

Three properties the loop is built to guarantee:

* **Mileage is conserved.** A leg split across several driving events always
  sums back to the leg's own distance, because each segment's distance is
  *subtracted* from the leg total rather than recomputed (see `_remaining_of`).
* **It terminates.** Two independent guards: a no-progress detector that catches
  a remedy which cannot help, and a hard iteration ceiling behind it.
* **A partial plan is never returned.** If planning cannot reach the delivery,
  the result carries no events at all (BR-37/NFR-2.4, FR-4.5) — the
  `PlanningPause` explains why.

A successful plan is a contiguous, gap-free timeline spanning trip start to
delivery completion exactly (FR-4.1, FR-4.5). A short trip still produces
exactly what it always did:

    Pre-Trip Inspection (BR-21, opens the 14h window per BR-24)
      -> Driving        (leg 1)
      -> Pickup         (BR-17, 1 h On Duty)
      -> Driving        (leg 2)
      -> Dropoff        (BR-18, 1 h On Duty)
      -> Post-Trip Inspection (BR-22, closes the duty period)

A long one interleaves 30-minute breaks, fuel stops, 10-hour resets and 34-hour
restarts, each followed by a fresh pre-trip inspection where it opened a new
duty period.

No rule logic lives here. Evaluators decide what is legal and name the remedy;
`remedies.py` owns what a remedy is; this module only sequences them. Every
event is built by EventFactory and numbered by TimelineBuilder, and every clock
movement goes through `PlanningCursor.advance`.
"""
from __future__ import annotations

from datetime import timedelta
from decimal import ROUND_DOWN, Decimal

from apps.planning.choices import DutyStatus, EventType
from apps.planning.services.hos.constants import (
    DROPOFF_HOURS,
    PICKUP_HOURS,
    POSTTRIP_INSPECTION_HOURS,
    PRETRIP_INSPECTION_HOURS,
)
from apps.planning.services.hos.cursor import (
    PlannerAction,
    PlanningCursor,
    drivable_budget,
    group_into_days,
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
from apps.planning.services.hos.remedies import RemedyEngine, remedy_for

#: Hard ceiling on turns of the planning loop, behind the no-progress guard.
#: Never expected to fire: a legal plan makes progress on every turn, and the
#: no-progress guard catches the case where it cannot. This exists so that a
#: future rule whose remedy neither helps nor repeats still terminates with a
#: diagnosable failure instead of hanging a request thread. Sized far above any
#: real trip — a coast-to-coast run needs on the order of thirty turns.
MAX_PLANNING_ITERATIONS = 500

#: Matches TimelineEvent.distance_miles' two decimal places, so a segment's
#: distance survives persistence unchanged and the parts of a split leg still
#: sum to the whole once stored.
_MILES = Decimal('0.01')

#: Precision a drivable budget is rounded to before being floored to whole
#: minutes — see `_drivable_minutes`. Small enough to be irrelevant to any
#: rule, large enough to absorb Decimal division residue.
_MINUTE_EPSILON = Decimal('0.000001')


class PlanningEngine:
    """Coordinates registered RuleEvaluators over a Trip's route legs.

    No rule logic lives here — this class sequences calls to the evaluators,
    picks the constraint that binds soonest, and asks RemedyEngine to schedule
    whatever remedy that constraint named. Which 70-hour threshold counts as
    "exhausted" is CycleLimitEvaluator's business; how long a restart lasts is
    `remedies.py`'s. This class knows neither.
    """

    def __init__(self, evaluators: list[RuleEvaluator] | None = None) -> None:
        self._evaluators = sorted(evaluators or [], key=lambda evaluator: evaluator.priority())
        self._remedies = RemedyEngine()

    def plan(self, context: PlanningContext) -> PlanningResult:
        """Plan one trip, inserting legal remedies until the delivery is reached."""
        cursor = PlanningCursor(
            trip_start_time=context.trip_start_time,
            cycle_hours_used=context.cycle_hours_used,
            leg_count=len(context.route_legs),
        )

        cursor.record_activity(
            'trip_created',
            f'Trip planning started from {context.current_location_text} '
            f'with {context.cycle_hours_used}h already used in the 70-hour cycle.',
        )
        cursor.record_activity(
            'route_generated',
            f'Route generated: {len(context.route_legs)} leg(s), '
            f'{sum(leg.distance_miles for leg in context.route_legs)} miles.',
        )

        self._open_first_duty_period(context, cursor)

        # ---- the planning loop ----------------------------------------
        # One turn per driving increment, which is a whole leg when the rules
        # allow it and the legal part of a leg when they do not. The loop is
        # written against the cursor rather than an index precisely so a remedy
        # can be inserted mid-leg without restructuring it.
        iterations = 0
        while not cursor.destination_reached and not cursor.paused:
            iterations += 1
            if iterations > MAX_PLANNING_ITERATIONS:
                self._give_up(
                    context,
                    cursor,
                    reason=(
                        f'Planning did not converge within {MAX_PLANNING_ITERATIONS} '
                        f'steps; no compliant schedule was found.'
                    ),
                )
                break
            self._advance_along_route(context, cursor)

        if cursor.paused:
            # No compliant schedule exists, so the events accumulated so far
            # describe a trip that stops short of the delivery. Returning them
            # would be a partial plan, which BR-37/NFR-2.4 forbid and which
            # would break FR-4.5's "spans trip start to delivery completion
            # exactly" invariant. The pause and the RuleResults explain why.
            events: tuple = ()
        else:
            events = tuple(cursor.timeline.build())
            cursor.record_activity(
                'destination_reached',
                f'Destination reached at {context.dropoff_location_text}; '
                f'{len(events)} events across '
                f'{len(group_into_days(events))} day(s).',
            )

        return PlanningResult(
            context=context,
            events=events,
            rule_results=tuple(cursor.rule_results),
            days=group_into_days(events),
            pause=cursor.pause,
            activity=tuple(cursor.activity),
        )

    # ------------------------------------------------------------------
    # The loop body
    # ------------------------------------------------------------------

    def _advance_along_route(self, context: PlanningContext, cursor: PlanningCursor) -> None:
        """Take one step: either finish the current leg, or drive part of it
        and insert the remedy that stopped it.
        """
        leg = context.route_legs[cursor.leg_index]
        remaining_minutes, remaining_miles = self._remaining_of(leg, cursor)

        results = self._evaluate_driving(cursor, remaining_minutes, remaining_miles)
        cursor.rule_results.extend(results)
        binding = self._select_binding_constraint(results, remaining_minutes, remaining_miles)

        if binding is None:
            # The whole of what is left of this leg is legal.
            self._emit_driving(cursor, leg, remaining_minutes, remaining_miles)
            self._emit_arrival(context, cursor, leg, is_final=cursor.is_final_leg)
            cursor.complete_leg()
            return

        # Drive as far as the binding constraint permits, then remedy it. A
        # zero-length drivable stretch is normal — it means the clock ran out
        # exactly at the current position — and emits no event (BR-35).
        drivable_minutes = self._drivable_minutes(binding, remaining_minutes, remaining_miles)
        if drivable_minutes > 0:
            segment_miles = self._segment_miles(
                remaining_miles, drivable_minutes, remaining_minutes
            )
            self._emit_driving(cursor, leg, drivable_minutes, segment_miles)
            cursor.advance_into_leg(drivable_minutes, segment_miles)

        self._insert_remedy(context, cursor, leg, binding)

    @staticmethod
    def _remaining_of(leg: RouteLegInput, cursor: PlanningCursor) -> tuple[int, Decimal]:
        """What is left of the current leg from the cursor's position.

        Always `total - progress`, never a running sum of the pieces: this is
        what makes the segments of a split leg add back up to the leg exactly,
        however many times it was split and whatever rounding each split needed.
        """
        return (
            leg.duration_minutes - cursor.minutes_into_leg,
            leg.distance_miles - cursor.distance_into_leg_miles,
        )

    # ------------------------------------------------------------------
    # Rules
    # ------------------------------------------------------------------

    def _evaluate_driving(
        self, cursor: PlanningCursor, minutes: int, miles: Decimal
    ) -> list[RuleResult]:
        """Ask every rule about the proposed driving increment.

        **Every** rule, not just up to the first block: picking the constraint
        that binds soonest means comparing all of them, and a rule that is never
        run cannot be compared. Evaluators are pure, so running them all costs
        only the call.

        Note which clocks are handed to which rule. BR-19 is measured from the
        last fuel stop, so it gets `distance_since_fuel_miles`, not the trip
        total; BR-4 is measured from the last qualifying break, so it gets
        `driving_since_break_hours`, not BR-1's per-duty-period total. Passing
        the trip totals to either would make the engine schedule stops that are
        not due, or — worse — fail to schedule ones that are.
        """
        eval_context = EvaluationContext(
            cumulative_driving_hours=cursor.clocks.driving_hours,
            elapsed_duty_window_hours=cursor.clocks.duty_window_hours,
            proposed_driving_hours=Decimal(minutes) / MINUTES_PER_HOUR,
            cumulative_distance_miles=cursor.clocks.distance_since_fuel_miles,
            proposed_distance_miles=miles,
            cumulative_cycle_hours=cursor.clocks.cycle_hours,
            driving_hours_since_break=cursor.clocks.driving_since_break_hours,
        )
        return [evaluator.evaluate(eval_context) for evaluator in self._evaluators]

    @staticmethod
    def _select_binding_constraint(
        results: list[RuleResult], minutes: int, miles: Decimal
    ) -> RuleResult | None:
        """Of the rules that blocked, the one that will actually bind first.

        Priority order is the wrong answer once remedies are inserted, and
        wrong in a way that produces a legal-looking plan for the wrong reason.
        Consider a driver with 2 hours left in the 70-hour cycle and 1 hour left
        in the 14-hour window: both rules block a 3-hour leg, but the cycle has
        the higher priority, so first-block-wins would schedule a 34-hour
        restart where a 10-hour reset was due — and would do it an hour later
        than the window actually allows.

        So: convert each blocking rule's remaining budget into hours of driving
        and take the smallest. Priority survives only as the tie-breaker, since
        `min` keeps the first of equal keys and `results` arrives in priority
        order. A rule that reports no usable budget sorts ahead of everything —
        it permits nothing, which is the earliest possible bind.
        """
        blocking = [result for result in results if not result.allowed]
        if not blocking:
            return None

        def binds_after(result: RuleResult) -> Decimal:
            hours, _ = drivable_budget(result, minutes, miles)
            return hours if hours is not None else Decimal('-1')

        return min(blocking, key=binds_after)

    @staticmethod
    def _drivable_minutes(binding: RuleResult, minutes: int, miles: Decimal) -> int:
        """Whole minutes of driving the binding constraint still permits.

        Rounded **down**, always: a partial minute of driving beyond the limit
        is a violation, and rounding up to reach a tidier split point would
        produce exactly the non-compliant plan BR-37 forbids.

        Clamped into `[0, minutes]` defensively. A blocking result reports a
        budget strictly smaller than the increment it rejected, so the clamp
        should never bite — but "should never" is not a guarantee to hand an
        arithmetic that decides whether a driver may keep driving.

        The quantise before the floor is not cosmetic. A budget derived by
        division carries Decimal's 28-significant-digit residue: a fuel budget
        of 1,000 of 1,500 miles over two hours comes back as
        79.99999999999999999999999998 minutes, which floors to 79 and quietly
        strands a minute of driving at every single split. Rounding away the
        last few digits first — 60 microseconds, far below the whole-minute
        resolution everything else here uses — recovers the 80.
        """
        hours, _ = drivable_budget(binding, minutes, miles)
        if hours is None or hours <= 0:
            return 0
        exact = (hours * MINUTES_PER_HOUR).quantize(_MINUTE_EPSILON)
        return max(0, min(int(exact), minutes))

    @staticmethod
    def _segment_miles(remaining_miles: Decimal, minutes: int, remaining_minutes: int) -> Decimal:
        """The distance covered by driving `minutes` of what is left of a leg.

        Pro-rated on the leg's own average speed and rounded **down** to the
        two decimal places the timeline stores, so the segment never claims
        mileage the remainder then has to give back. Whatever this leaves
        behind is picked up exactly by the next call to `_remaining_of`.
        """
        if remaining_minutes <= 0:
            return Decimal('0')
        pro_rata = remaining_miles * Decimal(minutes) / Decimal(remaining_minutes)
        return pro_rata.quantize(_MILES, rounding=ROUND_DOWN)

    # ------------------------------------------------------------------
    # Remedies
    # ------------------------------------------------------------------

    def _insert_remedy(
        self,
        context: PlanningContext,
        cursor: PlanningCursor,
        leg: RouteLegInput,
        binding: RuleResult,
    ) -> None:
        """Schedule the remedy the binding rule named, then resume.

        Stops the plan in exactly two cases: the rule named no remedy this
        engine can schedule, or the remedy it named was already applied and
        nothing has been driven since — which means applying it again cannot
        help, because remedies are idempotent on the clocks they clear.
        """
        remedy = remedy_for(binding.required_action)
        if remedy is None:
            self._give_up(
                context,
                cursor,
                reason=binding.reason,
                binding=binding,
                leg=leg,
                detail=(
                    'no legal remedy exists for this rule'
                    if binding.required_action is RequiredAction.NONE
                    else f'the required action "{binding.required_action.value}" '
                    f'is not one this engine can schedule'
                ),
            )
            return

        if (
            not cursor.drove_since_last_remedy
            and cursor.last_remedy_action == remedy.action.value
        ):
            self._give_up(
                context,
                cursor,
                reason=binding.reason,
                binding=binding,
                leg=leg,
                detail=(
                    f'a {remedy.label} was already taken and no driving was possible '
                    f'afterwards, so repeating it cannot make progress'
                ),
            )
            return

        location_name, latitude, longitude = self._position_on(leg, cursor)

        outcome = self._remedies.apply(
            cursor,
            remedy,
            location_name=location_name,
            latitude=latitude,
            longitude=longitude,
            reason=binding.reason,
        )
        cursor.record_activity(
            'remedy_inserted',
            f'{remedy.label.capitalize()} inserted at {location_name}: {binding.reason}',
            rule_id=binding.rule_id,
            leg_sequence=leg.sequence,
        )

        if outcome.opened_new_duty_period:
            self._emit_pretrip_inspection(
                cursor,
                location_name=location_name,
                latitude=latitude,
                longitude=longitude,
                reason=(
                    f'Pre-trip inspection opening the duty period that begins after the '
                    f'{remedy.label} (BR-21; a qualifying off-duty block starts a new '
                    f'duty period).'
                ),
            )

        cursor.record_activity(
            'planning_resumed',
            f'Planning resumed on leg {leg.sequence} toward {leg.destination_text}.',
            leg_sequence=leg.sequence,
        )

    def _give_up(
        self,
        context: PlanningContext,
        cursor: PlanningCursor,
        *,
        reason: str,
        binding: RuleResult | None = None,
        leg: RouteLegInput | None = None,
        detail: str | None = None,
    ) -> None:
        """Record the pause that ends the plan without a delivery."""
        leg = leg if leg is not None else context.route_legs[min(cursor.leg_index, cursor.leg_count - 1)]
        remaining_minutes, remaining_miles = self._remaining_of(leg, cursor)

        blocking = binding if binding is not None else RuleResult(
            allowed=False,
            evaluator_name='PlanningEngine',
            reason=reason,
            required_action=RequiredAction.NONE,
        )
        cursor.record_pause(
            leg_sequence=leg.sequence,
            blocking=blocking,
            leg_duration_minutes=max(remaining_minutes, 0),
            leg_distance_miles=max(remaining_miles, Decimal('0')),
        )
        cursor.record_activity(
            'planning_failed',
            f'Planning stopped on leg {leg.sequence}: {reason}'
            + (f' ({detail})' if detail else ''),
            rule_id=blocking.rule_id,
            leg_sequence=leg.sequence,
        )

    # ------------------------------------------------------------------
    # Position
    # ------------------------------------------------------------------

    @staticmethod
    def _position_on(leg: RouteLegInput, cursor: PlanningCursor) -> tuple[str, float, float]:
        """Where the truck is on the current leg: a name and a coordinate.

        At the start of a leg this is exactly the leg's origin, which is what
        keeps an unsplit trip's events identical to what they always were.

        Part-way through, there is nothing exact to return: `RouteLegInput`
        carries the two endpoints and no geometry, so the position is
        interpolated along the straight line between them, proportionally to
        the distance driven. That places a break marker near the right part of
        the route rather than on it. Carrying the real polyline into the engine
        would fix it, and is an input-model change (the encoded geometry exists
        on the routing side but is not part of the engine's contract) rather
        than an engine one.

        The stop's *timing* is unaffected by any of this — the duty clocks
        decide when to stop, and they are exact. Only the pin is approximate.
        """
        driven = cursor.distance_into_leg_miles
        if driven <= 0 and cursor.minutes_into_leg <= 0:
            return leg.origin_text, leg.origin_latitude, leg.origin_longitude

        if leg.distance_miles > 0:
            fraction = float(driven / leg.distance_miles)
        elif leg.duration_minutes > 0:
            fraction = cursor.minutes_into_leg / leg.duration_minutes
        else:
            fraction = 0.0
        fraction = min(max(fraction, 0.0), 1.0)

        latitude = leg.origin_latitude + (leg.destination_latitude - leg.origin_latitude) * fraction
        longitude = (
            leg.origin_longitude + (leg.destination_longitude - leg.origin_longitude) * fraction
        )
        # Truncated to the column width; a long resolved place name plus the
        # prefix can otherwise exceed TimelineEvent.location_name's 255.
        name = f'En route to {leg.destination_text} ({int(driven)} mi into leg {leg.sequence})'
        return name[:255], latitude, longitude

    # ------------------------------------------------------------------
    # Events
    # ------------------------------------------------------------------

    def _open_first_duty_period(self, context: PlanningContext, cursor: PlanningCursor) -> None:
        """Start the trip: a pre-flight restart if the cycle is exhausted,
        otherwise the pre-trip inspection that opens the first duty period.

        A restart opens its own duty period and so emits its own inspection,
        which is why only one of the two paths runs.
        """
        if self._apply_preflight_restart(context, cursor):
            return

        # Open the first duty period (BR-21). The 14-hour window opens at the
        # start of this inspection, not at the first driving minute (BR-24).
        origin = context.route_legs[0]
        self._emit_pretrip_inspection(
            cursor,
            location_name=context.current_location_text,
            latitude=origin.origin_latitude,
            longitude=origin.origin_longitude,
            reason=(
                'Pre-trip inspection opening the duty period; the 14-hour duty '
                'window starts here (BR-21, BR-24).'
            ),
        )

    @staticmethod
    def _duration(hours: Decimal) -> timedelta:
        """Convert a Decimal hour count to an exact whole-minute timedelta.

        Every duration in constants.py is an exact multiple of a minute, so
        this never truncates — going via minutes keeps float out of the
        clock arithmetic entirely.
        """
        return timedelta(minutes=int(hours * MINUTES_PER_HOUR))

    def _emit_pretrip_inspection(
        self,
        cursor: PlanningCursor,
        *,
        location_name: str,
        latitude: float,
        longitude: float,
        reason: str,
    ) -> None:
        """Open a duty period with a 15-minute pre-trip inspection (BR-21).

        The one place a duty period is opened, called from all three: trip
        start, after the pre-flight restart, and after any remedy that ends a
        duty period mid-trip. The 14-hour window opens at the *start* of this
        inspection, not at the first driving minute (BR-24).
        """
        start = cursor.current_time
        end = start + self._duration(PRETRIP_INSPECTION_HOURS)
        cursor.timeline.add_event(
            EventFactory.create_event(
                start_time=start,
                end_time=end,
                duty_status=DutyStatus.ON_DUTY_NOT_DRIVING,
                event_type=EventType.PRETRIP_INSPECTION,
                location_name=location_name,
                latitude=latitude,
                longitude=longitude,
                reason=reason,
            )
        )
        cursor.advance(PlannerAction.PRETRIP, PRETRIP_INSPECTION_HOURS)

    def _emit_driving(
        self,
        cursor: PlanningCursor,
        leg: RouteLegInput,
        minutes: int,
        distance_miles: Decimal,
    ) -> None:
        """Emit one Driving event for a stretch of a leg.

        A stretch is the whole leg when the rules allowed it and the legal part
        of one when they did not. Located at wherever the truck currently is,
        because that is where the duty-status change happens and therefore
        where BR-29's log remark belongs.

        A zero-duration stretch (EC-1, a same-location hop) contributes no
        event at all rather than a zero-length one, per BR-35.
        """
        if minutes <= 0:
            return

        is_whole_leg = cursor.minutes_into_leg == 0 and minutes == leg.duration_minutes
        location_name, latitude, longitude = self._position_on(leg, cursor)

        if is_whole_leg:
            reason = (
                f'Driving leg {leg.sequence} from {leg.origin_text} to '
                f'{leg.destination_text} (BR-13).'
            )
        else:
            reason = (
                f'Driving leg {leg.sequence} toward {leg.destination_text}: '
                f'{distance_miles} miles of the leg, split to stay within the '
                f'hours-of-service limits (BR-13).'
            )

        start = cursor.current_time
        cursor.timeline.add_event(
            EventFactory.create_event(
                start_time=start,
                end_time=start + timedelta(minutes=minutes),
                duty_status=DutyStatus.DRIVING,
                event_type=EventType.DRIVE,
                location_name=location_name,
                latitude=latitude,
                longitude=longitude,
                reason=reason,
                distance_miles=distance_miles,
            )
        )
        # Driving accrues against the driving clock, the break trigger, the
        # duty window and the cycle at once — advance() is what keeps them
        # from diverging.
        cursor.advance_minutes(
            PlannerAction.DRIVING,
            minutes,
            distance_miles=distance_miles,
            counts_as_driving=True,
        )
        cursor.drove_since_last_remedy = True
        cursor.record_activity(
            'driving_completed',
            f'Drove {distance_miles} miles on leg {leg.sequence}'
            + ('' if is_whole_leg else ' (partial segment)') + '.',
            leg_sequence=leg.sequence,
        )

    def _emit_arrival(
        self,
        context: PlanningContext,
        cursor: PlanningCursor,
        leg: RouteLegInput,
        is_final: bool,
    ) -> None:
        """Emit the on-duty work waiting at the end of a leg.

        The final leg ends at the delivery: one hour of unloading (BR-18)
        followed by the post-trip inspection that closes the duty period
        (BR-22), which is the trip's last event. Every earlier leg ends at
        the pickup: one hour of loading (BR-17). All events here are On Duty
        (Not Driving) per BR-14.

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
        guard can never halt a plan the main loop would otherwise have
        handled.

        This runs before the loop rather than inside it because there is no
        driving to split yet: the truck has not moved, so the restart needs no
        position and the loop's split arithmetic has nothing to work on. The
        restart *itself* goes through the same RemedyEngine as a mid-trip one,
        so there is only one definition of what a 34-hour restart does.

        **Assumption (approved): a 34-hour restart begins a new duty period,
        and therefore emits its own pre-trip inspection.**
        `hos-engine-design.md` records duty-period granularity as the design's
        most consequential open question — BR-21/BR-22 bracket "each duty
        period" without the PRD defining where one ends. This engine resolves
        it as: any qualifying off-duty block of 10 hours or more (so every
        10-hour reset and every 34-hour restart) closes one duty period and
        opens the next, which gets a fresh 15-minute pre-trip inspection. The
        14-hour window then opens at the *start* of that inspection, not at the
        first driving minute (BR-24).
        """
        probe = EvaluationContext(
            cumulative_driving_hours=Decimal('0'),
            elapsed_duty_window_hours=Decimal('0'),
            proposed_driving_hours=Decimal('0'),
            cumulative_cycle_hours=cursor.clocks.cycle_hours,
        )
        # First-block-wins is the right semantics here, unlike in the loop:
        # this is a yes/no guard on a zero-length increment, not a choice
        # between constraints that bind at different times.
        blocking_result = self._first_block(probe)

        if blocking_result is None or blocking_result.required_action is not RequiredAction.RESTART_34:
            return False

        remedy = remedy_for(RequiredAction.RESTART_34)
        if remedy is None:  # pragma: no cover - the table always has this entry
            return False

        # Only the blocking result is recorded: the probe's allowed results are
        # a guard, not part of the per-leg audit trail.
        cursor.rule_results.append(blocking_result)

        # Both events sit at the trip's start location. PlanningContext
        # guarantees at least one leg, and no interpolation is needed because
        # the truck has not moved yet.
        origin = context.route_legs[0]
        location_name = context.current_location_text

        self._remedies.apply(
            cursor,
            remedy,
            location_name=location_name,
            latitude=origin.origin_latitude,
            longitude=origin.origin_longitude,
            reason=blocking_result.reason,
        )
        cursor.record_activity(
            'remedy_inserted',
            f'{remedy.label.capitalize()} inserted before departure: {blocking_result.reason}',
            rule_id=blocking_result.rule_id,
        )

        self._emit_pretrip_inspection(
            cursor,
            location_name=location_name,
            latitude=origin.origin_latitude,
            longitude=origin.origin_longitude,
            reason=(
                f'Pre-trip inspection opening the duty period that begins after the '
                f'{remedy.label} (BR-21; a qualifying off-duty block starts a new '
                f'duty period).'
            ),
        )
        cursor.record_activity('planning_resumed', 'Planning resumed after the cycle restart.')
        return True

    def _first_block(self, eval_context: EvaluationContext) -> RuleResult | None:
        """The first evaluator to block, in priority order, or None.

        Used only by the pre-flight guard. The main loop compares every rule
        instead — see `_select_binding_constraint`.
        """
        for evaluator in self._evaluators:
            result = evaluator.evaluate(eval_context)
            if not result.allowed:
                return result
        return None
