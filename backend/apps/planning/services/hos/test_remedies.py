"""Phase 12B — remedy insertion, mid-leg splitting, and loop safety.

The engine is now a scheduler rather than a validator, and these cover the three
things that makes true: it inserts the *right* remedy, it splits a leg without
losing or inventing mileage, and it stops rather than looping when no remedy can
help.

`LegalityTests` at the end is the important one. It re-derives every duty clock
from the emitted timeline against the raw federal limits, deliberately without
using the evaluators — a bug shared between the engine and the rules it consults
would be invisible to a check that consulted the same rules
(docs/hos-engine-design.md §3, R-1 mitigation).
"""
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

from django.test import SimpleTestCase

from apps.planning.choices import DutyStatus, EventType
from apps.planning.services.hos.constants import (
    EIGHT_HOUR_BREAK_TRIGGER,
    ELEVEN_HOUR_DRIVING_LIMIT,
    FOURTEEN_HOUR_DUTY_WINDOW,
    FUEL_INTERVAL_MILES,
    SEVENTY_HOUR_CYCLE_LIMIT,
)
from apps.planning.services.hos.cursor import PlannerAction, PlanningCursor
from apps.planning.services.hos.engine import MAX_PLANNING_ITERATIONS, PlanningEngine
from apps.planning.services.hos.evaluators import default_evaluators
from apps.planning.services.hos.evaluators.base import RuleEvaluator
from apps.planning.services.hos.models import (
    EvaluationContext,
    PlanningContext,
    RequiredAction,
    RouteLegInput,
    RuleResult,
)
from apps.planning.services.hos.remedies import REMEDIES, RemedyEngine, remedy_for
from apps.planning.services.hos.test_cursor import UnremediableEvaluator

START = datetime(2026, 7, 27, 8, 0, tzinfo=dt_timezone.utc)

SHORT_LEG = RouteLegInput(
    sequence=1,
    origin_text='Dallas, TX',
    destination_text='Fort Worth, TX',
    origin_latitude=32.7767,
    origin_longitude=-96.7970,
    destination_latitude=32.7555,
    destination_longitude=-97.3308,
    distance_miles=Decimal('35.00'),
    duration_minutes=46,
)


def leg(sequence: int, minutes: int, miles: str) -> RouteLegInput:
    return RouteLegInput(
        sequence=sequence,
        origin_text=f'Origin {sequence}',
        destination_text=f'Destination {sequence}',
        origin_latitude=32.0,
        origin_longitude=-96.0,
        destination_latitude=41.0,
        destination_longitude=-87.0,
        distance_miles=Decimal(miles),
        duration_minutes=minutes,
    )


def plan(*legs: RouteLegInput, cycle_hours_used: str = '0', evaluators=None):
    engine = PlanningEngine(evaluators=evaluators or default_evaluators())
    return engine.plan(
        PlanningContext(
            trip_id=uuid.uuid4(),
            current_location_text='Dallas, TX',
            pickup_location_text='Fort Worth, TX',
            dropoff_location_text='Chicago, IL',
            trip_start_time=START,
            cycle_hours_used=Decimal(cycle_hours_used),
            route_legs=legs or (SHORT_LEG,),
        )
    )


def types_of(result) -> list[str]:
    return [event.event_type for event in result.events]


def driving(result):
    return [event for event in result.events if event.event_type == EventType.DRIVE]


def hours_of(event) -> Decimal:
    return Decimal((event.end_time - event.start_time).total_seconds()) / Decimal('3600')


class RemedyTableTests(SimpleTestCase):
    """The dispatch table is the whole policy — it is worth asserting directly."""

    def test_every_actionable_required_action_has_exactly_one_remedy(self):
        actionable = [action for action in RequiredAction if action is not RequiredAction.NONE]

        for action in actionable:
            with self.subTest(action=action):
                self.assertIsNotNone(remedy_for(action), f'{action} has no remedy')

        self.assertEqual(len(REMEDIES), len(actionable))

    def test_no_remedy_exists_for_the_neutral_action(self):
        # RequiredAction.NONE means "nothing would make this legal", which is
        # the engine's only genuine failure condition.
        self.assertIsNone(remedy_for(RequiredAction.NONE))

    def test_a_break_clears_the_break_trigger_and_nothing_else(self):
        remedy = remedy_for(RequiredAction.BREAK_30)

        self.assertTrue(remedy.satisfies_break)
        self.assertFalse(remedy.opens_new_duty_period)
        self.assertFalse(remedy.clears_cycle)
        self.assertFalse(remedy.refuels)

    def test_only_the_thirty_four_hour_restart_clears_the_cycle(self):
        # BR-10: nothing else does, and a daily reset in particular does not.
        clearing = [action for action, remedy in REMEDIES.items() if remedy.clears_cycle]

        self.assertEqual(clearing, [RequiredAction.RESTART_34])

    def test_only_fuelling_clears_the_fuel_interval(self):
        # BR-19 counts miles driven; resting does not un-drive them.
        refuelling = [action for action, remedy in REMEDIES.items() if remedy.refuels]

        self.assertEqual(refuelling, [RequiredAction.FUEL])

    def test_a_fuel_stop_is_on_duty_while_every_rest_is_off_duty(self):
        # Fuelling is work (BR-14), so it spends cycle hours; rest does not.
        self.assertEqual(
            REMEDIES[RequiredAction.FUEL].duty_status, DutyStatus.ON_DUTY_NOT_DRIVING
        )
        self.assertTrue(REMEDIES[RequiredAction.FUEL].counts_as_on_duty)
        for action in (RequiredAction.BREAK_30, RequiredAction.RESET_10, RequiredAction.RESTART_34):
            with self.subTest(action=action):
                self.assertEqual(REMEDIES[action].duty_status, DutyStatus.OFF_DUTY)
                self.assertFalse(REMEDIES[action].counts_as_on_duty)

    def test_the_engine_holds_no_remedy_duration_of_its_own(self):
        # Durations live in constants.py and reach the engine only through the
        # table, so a remedy's length can be changed in one place.
        self.assertEqual(REMEDIES[RequiredAction.BREAK_30].hours, Decimal('0.5'))
        self.assertEqual(REMEDIES[RequiredAction.RESET_10].hours, Decimal('10'))
        self.assertEqual(REMEDIES[RequiredAction.RESTART_34].hours, Decimal('34'))


class RemedySelectionTests(SimpleTestCase):
    """The right remedy for the rule that actually binds first."""

    def test_the_break_trigger_earns_a_break_not_a_reset(self):
        # 10h of driving: past BR-4's 8h trigger, inside BR-1's 11h limit.
        result = plan(leg(1, 10 * 60, '500.00'))

        self.assertIn(EventType.REST_BREAK_30, types_of(result))
        self.assertNotIn(EventType.DAILY_REST_10, types_of(result))

    def test_the_driving_limit_earns_a_reset(self):
        # 12h of driving needs both: a break at 8h, then a reset at 11h.
        result = plan(leg(1, 12 * 60, '600.00'))

        self.assertIn(EventType.REST_BREAK_30, types_of(result))
        self.assertIn(EventType.DAILY_REST_10, types_of(result))

    def test_the_fuel_interval_earns_a_fuel_stop(self):
        # Fast enough that no time-based rule fires: only BR-19 can block.
        result = plan(leg(1, 2 * 60, '1400.00'))

        self.assertIn(EventType.FUEL, types_of(result))
        self.assertNotIn(EventType.REST_BREAK_30, types_of(result))

    def test_an_exhausted_cycle_mid_trip_earns_a_restart(self):
        # Starts at 69h of a 70h cycle, so the cycle binds before anything else.
        result = plan(leg(1, 4 * 60, '200.00'), cycle_hours_used='69')

        self.assertIn(EventType.CYCLE_RESTART_34, types_of(result))

    def test_the_nearest_binding_constraint_wins_over_the_higher_priority_one(self):
        # A 10-hour leg with 60.75 cycle hours already spent. After the 15-minute
        # pre-trip inspection the cycle has 9 hours left while BR-4's trigger has
        # 8, so both rules block — and BR-8 has the higher priority (10 vs 30).
        #
        # First-block-wins would open with a 34-hour restart, an entire lost day
        # to fix a problem that will not arise for another hour. Nearest-binding
        # opens with the 30-minute break that is actually due. The restart still
        # comes later, when the cycle really does run out; what matters is which
        # is first.
        types = types_of(plan(leg(1, 10 * 60, '500.00'), cycle_hours_used='60.75'))

        remedies = [
            event_type
            for event_type in types
            if event_type in (EventType.REST_BREAK_30, EventType.CYCLE_RESTART_34)
        ]
        self.assertEqual(remedies[0], EventType.REST_BREAK_30)

    def test_a_reset_opens_a_new_duty_period_with_its_own_inspection(self):
        result = plan(leg(1, 12 * 60, '600.00'))
        types = types_of(result)

        # One inspection to open the trip, one after the reset.
        self.assertEqual(types.count(EventType.PRETRIP_INSPECTION), 2)
        reset_at = types.index(EventType.DAILY_REST_10)
        self.assertEqual(types[reset_at + 1], EventType.PRETRIP_INSPECTION)

    def test_a_break_does_not_open_a_new_duty_period(self):
        # A break is not a reset: no fresh inspection, and the 14-hour window
        # keeps running underneath it.
        result = plan(leg(1, 10 * 60, '500.00'))

        self.assertEqual(types_of(result).count(EventType.PRETRIP_INSPECTION), 1)


class LegSplittingTests(SimpleTestCase):
    """Mileage and duration are conserved exactly across any number of splits."""

    def test_a_split_leg_still_covers_the_whole_distance(self):
        result = plan(leg(1, 20 * 60, '1100.00'))

        self.assertGreater(len(driving(result)), 1)
        self.assertEqual(
            sum(event.distance_miles for event in driving(result)), Decimal('1100.00')
        )

    def test_a_split_leg_still_takes_the_whole_duration(self):
        result = plan(leg(1, 20 * 60, '1100.00'))

        self.assertEqual(
            sum((event.end_time - event.start_time for event in driving(result)), timedelta()),
            timedelta(hours=20),
        )

    def test_a_leg_split_many_times_over_conserves_its_distance(self):
        # Long enough to need several breaks, several resets and several fuel
        # stops, so the rounding at each split has every chance to accumulate.
        result = plan(leg(1, 60 * 60, '3300.00'))

        self.assertGreater(len(driving(result)), 6)
        self.assertEqual(
            sum(event.distance_miles for event in driving(result)), Decimal('3300.00')
        )

    def test_distance_is_conserved_across_multiple_split_legs(self):
        result = plan(leg(1, 15 * 60, '800.00'), leg(2, 18 * 60, '950.00'))

        self.assertEqual(
            sum(event.distance_miles for event in driving(result)), Decimal('1750.00')
        )

    def test_no_driving_segment_is_empty(self):
        # BR-35: splitting must never produce a zero-length event.
        for event in driving(plan(leg(1, 20 * 60, '1100.00'))):
            with self.subTest(sequence=event.sequence):
                self.assertGreater(event.end_time, event.start_time)
                self.assertGreater(event.distance_miles, 0)

    def test_a_resumed_segment_starts_where_the_previous_one_stopped(self):
        result = plan(leg(1, 20 * 60, '1100.00'))
        segments = driving(result)

        # Each split point is reported as a mileage into the leg, and it must
        # match what the segments before it actually covered.
        covered = Decimal('0')
        for segment in segments[:-1]:
            covered += segment.distance_miles
            following = result.events[result.events.index(segment) + 1]
            self.assertIn(str(int(covered)), following.location_name)

    def test_a_split_point_lies_between_the_leg_endpoints(self):
        result = plan(leg(1, 20 * 60, '1100.00'))
        mid = next(
            event for event in result.events if event.event_type == EventType.REST_BREAK_30
        )

        # Interpolated along the leg: north of the origin, south of the
        # destination (32.0 -> 41.0).
        self.assertGreater(mid.latitude, 32.0)
        self.assertLess(mid.latitude, 41.0)

    def test_an_unsplit_leg_is_still_a_single_event_at_its_origin(self):
        result = plan(SHORT_LEG)
        segments = driving(result)

        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0].location_name, SHORT_LEG.origin_text)
        self.assertEqual(segments[0].distance_miles, SHORT_LEG.distance_miles)


class MultiDayTests(SimpleTestCase):
    def test_a_long_trip_is_grouped_into_real_days(self):
        result = plan(leg(1, 40 * 60, '2200.00'))

        self.assertGreater(len(result.days), 2)
        self.assertEqual(
            [day.day_number for day in result.days], list(range(1, len(result.days) + 1))
        )
        self.assertTrue(all(day.events for day in result.days))

    def test_every_event_appears_in_at_least_one_day(self):
        result = plan(leg(1, 40 * 60, '2200.00'))
        grouped = {event.sequence for day in result.days for event in day.events}

        self.assertEqual(grouped, {event.sequence for event in result.events})

    def test_the_timeline_stays_contiguous_across_day_boundaries(self):
        result = plan(leg(1, 40 * 60, '2200.00'))

        self.assertEqual(result.events[0].start_time, START)
        for previous, current in zip(result.events, result.events[1:]):
            with self.subTest(sequence=current.sequence):
                self.assertEqual(current.start_time, previous.end_time)

    def test_the_timeline_is_chronological_and_contiguously_numbered(self):
        result = plan(leg(1, 40 * 60, '2200.00'))

        self.assertEqual(
            [event.sequence for event in result.events],
            list(range(1, len(result.events) + 1)),
        )
        starts = [event.start_time for event in result.events]
        self.assertEqual(starts, sorted(starts))

    def test_the_trip_still_ends_at_the_delivery(self):
        result = plan(leg(1, 40 * 60, '2200.00'))

        self.assertEqual(result.events[-1].event_type, EventType.POSTTRIP_INSPECTION)
        self.assertEqual(result.events[-2].event_type, EventType.DROPOFF)


class ActivityLogTests(SimpleTestCase):
    def test_a_short_trip_is_narrated_from_creation_to_arrival(self):
        kinds = [entry.kind for entry in plan().activity]

        self.assertEqual(kinds[0], 'trip_created')
        self.assertEqual(kinds[1], 'route_generated')
        self.assertEqual(kinds[-1], 'destination_reached')
        self.assertIn('driving_completed', kinds)

    def test_a_remedied_trip_records_each_insertion_and_resumption(self):
        kinds = [entry.kind for entry in plan(leg(1, 20 * 60, '1100.00')).activity]

        self.assertEqual(kinds.count('remedy_inserted'), kinds.count('planning_resumed'))
        self.assertGreater(kinds.count('remedy_inserted'), 1)
        self.assertEqual(kinds[-1], 'destination_reached')

    def test_the_narrative_follows_the_order_the_user_asked_for(self):
        # created -> route -> drive -> remedy -> resume -> ... -> arrived
        kinds = [entry.kind for entry in plan(leg(1, 10 * 60, '500.00')).activity]

        self.assertEqual(
            kinds,
            [
                'trip_created',
                'route_generated',
                'driving_completed',
                'remedy_inserted',
                'planning_resumed',
                'driving_completed',
                'destination_reached',
            ],
        )

    def test_an_inserted_remedy_names_the_rule_that_required_it(self):
        inserted = [
            entry
            for entry in plan(leg(1, 10 * 60, '500.00')).activity
            if entry.kind == 'remedy_inserted'
        ]

        self.assertEqual([entry.rule_id for entry in inserted], ['BR-4'])
        self.assertIn('30-minute break', inserted[0].message)

    def test_entries_are_numbered_and_chronological(self):
        activity = plan(leg(1, 20 * 60, '1100.00')).activity

        self.assertEqual(
            [entry.sequence for entry in activity], list(range(1, len(activity) + 1))
        )
        self.assertEqual([e.at for e in activity], sorted(e.at for e in activity))

    def test_a_failed_plan_records_why_it_stopped(self):
        result = plan(evaluators=[*default_evaluators(), UnremediableEvaluator()])

        self.assertEqual(result.activity[-1].kind, 'planning_failed')
        self.assertIn('nothing can make it legal', result.activity[-1].message)


class LoopSafetyTests(SimpleTestCase):
    """The scheduler must terminate on inputs no remedy can fix."""

    def test_a_rule_with_no_remedy_stops_the_plan(self):
        result = plan(evaluators=[*default_evaluators(), UnremediableEvaluator()])

        self.assertEqual(result.events, ())
        self.assertIsNotNone(result.pause)
        self.assertEqual(result.pause.rule_id, 'BR-TEST')

    def test_a_remedy_that_cannot_help_is_not_applied_twice(self):
        # A rule that always demands a break: taking one changes nothing, so
        # the second identical request must be recognised as no progress rather
        # than repeated forever.
        result = plan(evaluators=[UnsatisfiableBreakEvaluator()])

        self.assertEqual(result.events, ())
        self.assertIsNotNone(result.pause)
        self.assertIn('cannot make progress', result.activity[-1].message)
        # Exactly one break was attempted before the engine gave up.
        self.assertLessEqual(len(result.rule_results), 3)

    def test_a_zero_duration_leg_with_distance_terminates(self):
        # Physically nonsense (1,500 miles in no time), so no fuel stop can
        # help — but it must fail rather than spin.
        result = plan(leg(1, 0, '1500.00'))

        self.assertEqual(result.events, ())
        self.assertIsNotNone(result.pause)

    def test_a_very_long_trip_stays_far_below_the_iteration_ceiling(self):
        # A coast-to-coast run: the ceiling is a backstop, not a working limit.
        result = plan(leg(1, 60 * 60, '3300.00'))

        self.assertTrue(result.events)
        self.assertLess(len(result.events), MAX_PLANNING_ITERATIONS)


class BackwardCompatibilityTests(SimpleTestCase):
    """A trip that needed no remedy must be untouched by all of this."""

    def test_a_short_trip_produces_the_same_six_events(self):
        result = plan(
            SHORT_LEG,
            RouteLegInput(
                sequence=2,
                origin_text='Fort Worth, TX',
                destination_text='Chicago, IL',
                origin_latitude=32.7555,
                origin_longitude=-97.3308,
                destination_latitude=41.8781,
                destination_longitude=-87.6298,
                distance_miles=Decimal('262.00'),
                duration_minutes=255,
            ),
        )

        self.assertEqual(
            types_of(result),
            [
                EventType.PRETRIP_INSPECTION,
                EventType.DRIVE,
                EventType.PICKUP,
                EventType.DRIVE,
                EventType.DROPOFF,
                EventType.POSTTRIP_INSPECTION,
            ],
        )
        self.assertIsNone(result.pause)
        self.assertEqual(len(result.days), 1)

    def test_a_short_trip_records_no_remedy_activity(self):
        kinds = [entry.kind for entry in plan().activity]

        self.assertNotIn('remedy_inserted', kinds)

    def test_the_preflight_restart_is_unchanged(self):
        result = plan(SHORT_LEG, cycle_hours_used='70')

        self.assertEqual(result.events[0].event_type, EventType.CYCLE_RESTART_34)
        self.assertEqual(result.events[0].start_time, START)
        self.assertEqual(hours_of(result.events[0]), Decimal('34'))
        self.assertEqual(result.events[1].event_type, EventType.PRETRIP_INSPECTION)
        self.assertEqual(types_of(result).count(EventType.PRETRIP_INSPECTION), 1)


class LegalityTests(SimpleTestCase):
    """Re-derive every clock from the emitted timeline and check it against the
    federal limits directly.

    Deliberately does not use the evaluators: a bug they share with the engine
    would be invisible to a check that asked them.
    """

    ROUTES = {
        'Dallas -> Houston': (leg(1, 46, '35.90'), leg(2, 255, '262.00')),
        'Dallas -> Seattle': (leg(1, 25, '20.00'), leg(2, 32 * 60, '2100.00')),
        'Dallas -> New York': (leg(1, 25, '20.00'), leg(2, 24 * 60, '1550.00')),
        'Los Angeles -> Miami': (leg(1, 25, '20.00'), leg(2, 41 * 60, '2730.00')),
    }

    def assert_legal(self, result):
        driving_hours = window = cycle = since_break = Decimal('0')
        since_fuel = Decimal('0')

        for event in result.events:
            span = hours_of(event)

            if event.event_type == EventType.DRIVE:
                driving_hours += span
                since_break += span
                window += span
                cycle += span
                since_fuel += event.distance_miles
                self.assertLessEqual(driving_hours, ELEVEN_HOUR_DRIVING_LIMIT, 'BR-1')
                self.assertLessEqual(since_break, EIGHT_HOUR_BREAK_TRIGGER, 'BR-4')
                self.assertLessEqual(window, FOURTEEN_HOUR_DUTY_WINDOW, 'BR-2')
                self.assertLessEqual(cycle, SEVENTY_HOUR_CYCLE_LIMIT, 'BR-8')
                self.assertLessEqual(since_fuel, FUEL_INTERVAL_MILES, 'BR-19')
                continue

            if event.event_type in (EventType.DAILY_REST_10, EventType.CYCLE_RESTART_34):
                driving_hours = window = since_break = Decimal('0')
                if event.event_type == EventType.CYCLE_RESTART_34:
                    cycle = Decimal('0')
                continue

            # Everything else spends the 14-hour window (BR-2 is consecutive
            # hours), and spends the cycle too unless it is off duty.
            window += span
            if event.event_type == EventType.REST_BREAK_30:
                since_break = Decimal('0')
            if event.event_type == EventType.FUEL:
                since_fuel = Decimal('0')
                since_break = Decimal('0')
            if event.duty_status not in (DutyStatus.OFF_DUTY, DutyStatus.SLEEPER_BERTH):
                cycle += span
            self.assertLessEqual(window, FOURTEEN_HOUR_DUTY_WINDOW, 'BR-2')
            self.assertLessEqual(cycle, SEVENTY_HOUR_CYCLE_LIMIT, 'BR-8')

    def test_every_reference_route_produces_a_legal_plan(self):
        for name, legs in self.ROUTES.items():
            with self.subTest(route=name):
                result = plan(*legs)
                self.assertTrue(result.events, f'{name} produced no plan')
                self.assert_legal(result)

    def test_every_reference_route_is_legal_with_a_nearly_spent_cycle(self):
        # Forces a mid-trip 34-hour restart into each of them.
        for name, legs in self.ROUTES.items():
            with self.subTest(route=name):
                result = plan(*legs, cycle_hours_used='65')
                self.assertTrue(result.events, f'{name} produced no plan')
                self.assert_legal(result)

    def test_every_reference_route_preserves_its_distance_and_duration(self):
        for name, legs in self.ROUTES.items():
            with self.subTest(route=name):
                result = plan(*legs)
                self.assertEqual(
                    sum(event.distance_miles for event in driving(result)),
                    sum(one.distance_miles for one in legs),
                )
                self.assertEqual(
                    sum(
                        (event.end_time - event.start_time for event in driving(result)),
                        timedelta(),
                    ),
                    timedelta(minutes=sum(one.duration_minutes for one in legs)),
                )

    def test_no_duplicated_events(self):
        for name, legs in self.ROUTES.items():
            with self.subTest(route=name):
                events = plan(*legs).events
                spans = [(event.start_time, event.end_time) for event in events]
                self.assertEqual(len(spans), len(set(spans)))


class UnsatisfiableBreakEvaluator(RuleEvaluator):
    """Always demands a break, which taking one can never satisfy.

    Models the pathological remedy loop directly: without the no-progress
    guard the engine would insert breaks until the iteration ceiling.
    """

    def priority(self) -> int:
        return 99

    def evaluate(self, context: EvaluationContext) -> RuleResult:
        if context.proposed_driving_hours <= 0:
            return RuleResult(allowed=True, evaluator_name='UnsatisfiableBreak', reason='ok')
        return RuleResult(
            allowed=False,
            evaluator_name='UnsatisfiableBreak',
            reason='A break is always required.',
            remaining_driving_hours=Decimal('0'),
            required_action=RequiredAction.BREAK_30,
            rule_id='BR-TEST2',
        )


class RemedyEngineUnitTests(SimpleTestCase):
    """RemedyEngine in isolation, without the planning loop around it."""

    def cursor(self) -> PlanningCursor:
        return PlanningCursor(START, Decimal('0'), leg_count=1)

    def test_applying_a_remedy_emits_its_event_and_moves_the_clock(self):
        cursor = self.cursor()

        RemedyEngine().apply(
            cursor,
            remedy_for(RequiredAction.BREAK_30),
            location_name='Somewhere',
            latitude=32.0,
            longitude=-96.0,
            reason='because',
        )

        self.assertEqual(cursor.current_time, START + timedelta(minutes=30))
        events = cursor.timeline.build()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].event_type, EventType.REST_BREAK_30)
        self.assertEqual(events[0].reason, 'because')

    def test_applying_a_reset_clears_the_duty_clocks_but_not_the_cycle(self):
        cursor = self.cursor()
        cursor.advance_minutes(PlannerAction.DRIVING, 10 * 60, counts_as_driving=True)

        RemedyEngine().apply(
            cursor,
            remedy_for(RequiredAction.RESET_10),
            location_name='Somewhere',
            latitude=32.0,
            longitude=-96.0,
            reason='because',
        )

        self.assertEqual(cursor.clocks.driving_hours, Decimal('0'))
        self.assertEqual(cursor.clocks.duty_window_hours, Decimal('0'))
        # BR-10: only a 34-hour restart clears the cycle. The ten hours of rest
        # are off duty, so they add nothing to it either.
        self.assertEqual(cursor.clocks.cycle_hours, Decimal('10'))

    def test_applying_a_remedy_records_it_for_the_no_progress_guard(self):
        cursor = self.cursor()

        RemedyEngine().apply(
            cursor,
            remedy_for(RequiredAction.FUEL),
            location_name='Somewhere',
            latitude=32.0,
            longitude=-96.0,
            reason='because',
        )

        self.assertEqual(cursor.last_remedy_action, 'fuel')
        self.assertFalse(cursor.drove_since_last_remedy)
