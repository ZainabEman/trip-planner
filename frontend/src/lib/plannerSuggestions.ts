/**
 * What a dispatcher can actually *do* about a failed plan.
 *
 * "No legal continuation exists" is true and useless. This turns the failure the
 * API reported into a short list of concrete next moves, ordered by how likely
 * each is to work for that particular rule.
 *
 * The suggestions changed meaning in this release and it is worth being precise
 * about why. The planner now inserts remedies automatically — breaks, resets,
 * restarts, fuel stops — so "take a 30-minute break" is no longer advice, it is
 * something the planner already did. A trip that still fails has exhausted the
 * remedies, which means the useful advice is about the *inputs*: when the driver
 * starts, how many cycle hours they arrive with, how far the load has to go, and
 * who is driving it.
 *
 * Routing failures get their own list, because they are not HOS problems at all
 * and the two were previously conflated under one generic message.
 */

export interface Suggestion {
  /** Imperative, short enough to scan. */
  action: string;
  /** Why it helps *this* failure. */
  rationale: string;
}

export interface SuggestionSet {
  /** One-line restatement of the problem in the dispatcher's terms. */
  headline: string;
  suggestions: Suggestion[];
}

const START_EARLIER: Suggestion = {
  action: 'Start earlier in the day',
  rationale:
    'The 14-hour window opens at the pre-trip inspection and does not pause. An earlier start puts more of the drive inside it.',
};

const REDUCE_CYCLE: Suggestion = {
  action: 'Assign a driver with more cycle hours available',
  rationale:
    'The 70-hour clock counts every on-duty hour from the previous eight days. A fresher driver starts with more of it left.',
};

const SPLIT_SHIPMENT: Suggestion = {
  action: 'Split the shipment across two trips',
  rationale: 'A shorter haul fits inside fewer duty periods and needs fewer inserted rests.',
};

const TEAM_DRIVER: Suggestion = {
  action: 'Add a second driver',
  rationale:
    'A team can keep the load moving while one driver rests, which the single-driver limits cannot.',
};

const CLOSER_PICKUP: Suggestion = {
  action: 'Change the pickup or delivery point',
  rationale: 'Shortening either leg reduces the driving hours the schedule has to fit.',
};

const RESTART_FIRST: Suggestion = {
  action: 'Schedule a 34-hour restart before this trip',
  rationale:
    'A restart sets the 70-hour cycle back to zero. Taking it before dispatch rather than mid-route avoids stranding the load.',
};

/**
 * Per-rule advice.
 *
 * Keyed on the `rule_id` the API returns in `error.details.rule_id`, so the
 * tailoring is driven by what the engine actually reported rather than by
 * pattern-matching its prose.
 */
const BY_RULE: Record<string, SuggestionSet> = {
  'BR-1': {
    headline: 'The drive needs more than 11 hours behind the wheel in one duty period.',
    suggestions: [SPLIT_SHIPMENT, TEAM_DRIVER, CLOSER_PICKUP, START_EARLIER],
  },
  'BR-2': {
    headline: 'The work runs past the 14-hour window that opens when the driver comes on duty.',
    suggestions: [START_EARLIER, SPLIT_SHIPMENT, TEAM_DRIVER, CLOSER_PICKUP],
  },
  'BR-4': {
    headline: 'The drive needs more than 8 cumulative hours without a qualifying break.',
    suggestions: [SPLIT_SHIPMENT, TEAM_DRIVER, START_EARLIER],
  },
  'BR-8': {
    headline: 'The driver has no hours left in the rolling 70-hour, 8-day cycle.',
    suggestions: [RESTART_FIRST, REDUCE_CYCLE, TEAM_DRIVER, SPLIT_SHIPMENT],
  },
  'BR-19': {
    headline: 'The route runs further between fuel stops than the 1,000-mile policy allows.',
    suggestions: [CLOSER_PICKUP, SPLIT_SHIPMENT],
  },
};

const GENERIC_HOS: SuggestionSet = {
  headline: 'No legal schedule exists for this trip, even with rest inserted.',
  suggestions: [START_EARLIER, REDUCE_CYCLE, SPLIT_SHIPMENT, TEAM_DRIVER, CLOSER_PICKUP],
};

const GEOCODING: SuggestionSet = {
  headline: 'One of the locations could not be found.',
  suggestions: [
    {
      action: 'Add the state or province',
      rationale: 'City names repeat across states — "Springfield, IL" resolves where "Springfield" cannot.',
    },
    {
      action: 'Use a nearby larger town',
      rationale: 'Very small places and new developments are often missing from the geocoder.',
    },
    {
      action: 'Check the spelling',
      rationale: 'The lookup matches on name, so a typo returns nothing rather than a near match.',
    },
  ],
};

const NO_ROUTE: SuggestionSet = {
  headline: 'No drivable road route connects these points.',
  suggestions: [
    {
      action: 'Check for a water crossing',
      rationale:
        'Islands and overseas destinations have no road route — Honolulu cannot be reached by truck from the mainland.',
    },
    {
      action: 'Use a more specific address',
      rationale:
        'A point that lands off the road network cannot be snapped to a road. A street address or town centre resolves better than a region.',
    },
    {
      action: 'Verify both ends are on the same landmass',
      rationale: 'The router will not invent a ferry or a bridge that does not exist.',
    },
  ],
};

const UNREACHABLE: SuggestionSet = {
  headline: 'The planner could not reach the server.',
  suggestions: [
    {
      action: 'Check the backend is running',
      rationale: 'The API must be reachable at the configured address for planning to run at all.',
    },
    {
      action: 'Retry the request',
      rationale: 'A single dropped connection resolves on a retry; a persistent one does not.',
    },
  ],
};

const PROVIDER_DOWN: SuggestionSet = {
  headline: 'The routing provider is temporarily unavailable.',
  suggestions: [
    {
      action: 'Wait a moment and retry',
      rationale: 'Provider timeouts and rate limits clear on their own. Nothing about the trip needs changing.',
    },
    {
      action: 'Re-check the trip once it succeeds',
      rationale: 'No route was computed, so the trip is still unplanned rather than illegal.',
    },
  ],
};

/**
 * Choose the advice that fits the failure.
 *
 * Order matters: the specific signals (a rule id, a geocoding detail) are
 * checked before the status-code fallbacks, because a 422 alone does not say
 * whether the hours or the map were the problem.
 */
export function suggestionsFor(error: {
  ruleId?: string | null;
  statusCode: number;
  details: Record<string, unknown>;
  isRetryable?: boolean;
}): SuggestionSet {
  if (error.statusCode === 0) return UNREACHABLE;
  if (error.ruleId) return BY_RULE[error.ruleId] ?? GENERIC_HOS;
  if (error.details.location) return GEOCODING;
  if (error.details.origin || error.details.destination) return NO_ROUTE;
  if (error.isRetryable || error.statusCode === 503) return PROVIDER_DOWN;
  if (error.statusCode === 422) return GENERIC_HOS;
  return {
    headline: 'Planning could not be completed.',
    suggestions: [GENERIC_HOS.suggestions[0], GENERIC_HOS.suggestions[2]],
  };
}

/** True when the failure is about the road network, not the driver's hours. */
export function isRoutingFailure(error: {
  ruleId?: string | null;
  details: Record<string, unknown>;
}): boolean {
  if (error.ruleId) return false;
  return Boolean(error.details.location || error.details.origin || error.details.destination);
}
