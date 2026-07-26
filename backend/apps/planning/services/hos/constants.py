"""RegulatoryConstants — the single home for every FMCSA numeric constant.

NFR-5.2 requires that each regulatory number live in exactly one place,
named and cross-referenced to its CFR section or PRD rule ID. Nothing
elsewhere in the HOS package may hardcode one of these values: evaluators
import the threshold they enforce, and PlanningEngine imports the
duration of the remedy it schedules.

Two distinct kinds of constant live here, and the distinction matters:

* **Thresholds** — the limits a RuleEvaluator tests a proposed increment
  against (11 h, 14 h, 8 h, 70 h, 1,000 mi). Each is read by exactly one
  evaluator.
* **Durations** — how long a scheduled event lasts (34 h restart, 30 min
  break, 15 min inspection). These are read by PlanningEngine, not by
  evaluators: an evaluator detects that a remedy is *needed* and never
  decides how long it *takes*. Keeping durations out of the evaluators is
  what stops a rule's trigger and its remedy from coupling (see
  models.RequiredAction).

This module is a deliberate leaf: it imports nothing from the HOS package,
so it can never participate in an import cycle.

It is also the seam a future ComplianceValidator needs. That validator must
re-check a finished Timeline through an *independently implemented* code
path so a shared bug cannot hide from it (docs/hos-engine-design.md §3,
R-1 mitigation) — but it should share these *numbers*, which is exactly
NFR-5.2's point. Sharing a constant is correct; sharing the comparison
logic is not.
"""
from __future__ import annotations

from decimal import Decimal

# --- Driving and duty thresholds -------------------------------------------

# BR-1 / 49 CFR 395.3(a)(3) — maximum driving hours per duty period.
# Read by DrivingLimitEvaluator.
ELEVEN_HOUR_DRIVING_LIMIT = Decimal('11.0')

# BR-2, BR-24 / 49 CFR 395.3(a)(2) — the consecutive-hours window, which
# opens at the start of the pre-trip inspection and does not pause for
# non-driving work. Read by DutyWindowEvaluator.
FOURTEEN_HOUR_DUTY_WINDOW = Decimal('14.0')

# BR-4 / 49 CFR 395.3(a)(3)(ii) — cumulative (not consecutive) driving
# hours after which a 30-minute break becomes mandatory.
# Read by BreakEvaluator.
EIGHT_HOUR_BREAK_TRIGGER = Decimal('8.0')

# BR-8 / 49 CFR 395.3(b)(2) — maximum on-duty hours (all statuses, not
# just driving) in a rolling 8-day cycle. Read by CycleLimitEvaluator.
#
# Note that BR-9's rolling drop-out is not implemented: the engine's only
# cycle input is a scalar, so no individual day's hours can be identified
# and removed. See evaluators/cycle_limit.py and Assumption 8 in
# docs/hos-engine-design.md for why this is a supported simplification.
SEVENTY_HOUR_CYCLE_LIMIT = Decimal('70.0')

# BR-19 / PRD Assumption A-14 — miles after which a fuel stop is due,
# measured from trip start or the last fuel stop. A product policy
# constant rather than a Part 395 rule, but treated identically here.
# Read by FuelEvaluator.
FUEL_INTERVAL_MILES = Decimal('1000')


# --- Event durations -------------------------------------------------------

# BR-10 / 49 CFR 395.3(c) — consecutive off-duty hours that reset the
# 70-hour cycle to zero. Scheduled by PlanningEngine.
CYCLE_RESTART_HOURS = Decimal('34')

# BR-4, BR-5 — the qualifying non-driving block that clears the
# 8-cumulative-hour break trigger. Defined here for completeness alongside
# its trigger above; not yet consumed, because PlanningEngine does not
# schedule the BREAK_30 remedy yet.
THIRTY_MINUTE_BREAK_HOURS = Decimal('0.5')

# BR-21 — the inspection that opens a duty period, taken On Duty (Not
# Driving). Scheduled by PlanningEngine after a 34-hour restart, on the
# assumption that a restart begins a new duty period (Assumption 2,
# docs/hos-engine-design.md). BR-22's post-trip inspection is the same
# 15 minutes and belongs here as POSTTRIP_INSPECTION_HOURS once the
# engine closes duty periods.
PRETRIP_INSPECTION_HOURS = Decimal('0.25')

# Deliberately not yet defined, to avoid unused constants that read as
# dead code: BR-7's 10-hour reset duration, BR-20's 30-minute fuel stop,
# BR-17/BR-18's 1-hour pickup and dropoff, and BR-22's post-trip
# inspection. Each belongs here when the phase that schedules it lands.
