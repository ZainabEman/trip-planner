/**
 * Dispatcher-readable explanations for a blocked plan.
 *
 * The engine's own message is precise but regulatory:
 *
 *   "Driving 20h would bring elapsed duty-window time to 23.25h, exceeding the
 *    14-hour duty window (BR-2)."
 *
 * That belongs in the record, not in the headline. This module turns the two
 * things the API actually sends — `rule_id` and that message — into: what
 * happened, why, what the planner would do about it, and how much of each clock
 * was left.
 *
 * The numbers are **derived from the engine's own message**, not invented. Each
 * message is templated as "…{proposed} … to {projected}h/miles …", so:
 *
 *     alreadyUsed = projected − proposed
 *     remaining   = limit − alreadyUsed
 *
 * If the shape ever changes, the parse returns null and the card falls back to
 * showing the limit alone rather than a wrong figure.
 */

export type RemedyKind = 'break_30' | 'reset_10' | 'restart_34' | 'fuel' | 'none';

export interface RuleExplanation {
  ruleId: string;
  name: string;
  /** The federal limit, as a display string. */
  limit: string;
  /** Plain-language statement of what the planner hit. */
  what: string;
  /** Why the limit exists / why it triggered here. */
  why: string;
  /** The legal remedy for this rule. */
  remedy: RemedyKind;
  remedyLabel: string;
  /** What a dispatcher can do about it right now. */
  /** Which clock the numbers below refer to. */
  clock: 'driving' | 'duty' | 'cycle' | 'distance';
  limitValue: number;
  unit: 'h' | 'mi';
}

export const RULE_EXPLANATIONS: Record<string, RuleExplanation> = {
  'BR-1': {
    ruleId: 'BR-1',
    name: '11-hour driving limit',
    limit: '11 hours driving',
    what: 'The trip needs more than 11 hours of driving in a single duty period.',
    why: 'A driver may not drive more than 11 hours after coming on duty, no matter how the day is arranged.',
    remedy: 'reset_10',
    remedyLabel: '10-hour off-duty reset',
    clock: 'driving',
    limitValue: 11,
    unit: 'h',
  },
  'BR-2': {
    ruleId: 'BR-2',
    name: '14-hour duty window',
    limit: '14 hours on duty',
    what: 'The trip runs past the 14-hour window that opened when the driver came on duty.',
    why: 'The 14-hour clock does not pause. Loading, waiting and breaks all burn it, so a long dock wait can end the day before the driving does.',
    remedy: 'reset_10',
    remedyLabel: '10-hour off-duty reset',
    clock: 'duty',
    limitValue: 14,
    unit: 'h',
  },
  'BR-4': {
    ruleId: 'BR-4',
    name: '30-minute break',
    limit: '8 hours cumulative driving',
    what: 'The trip needs more than 8 cumulative hours of driving without a 30-minute break.',
    why: 'The 8 hours add up across the whole day — they do not have to be consecutive — and driving is barred until a 30-minute non-driving block is taken.',
    remedy: 'break_30',
    remedyLabel: '30-minute break',
    clock: 'driving',
    limitValue: 8,
    unit: 'h',
  },
  'BR-8': {
    ruleId: 'BR-8',
    name: '70-hour cycle',
    limit: '70 on-duty hours / 8 days',
    what: 'The driver has no hours left in the rolling 70-hour, 8-day cycle.',
    why: 'The cycle counts every on-duty hour — inspections, loading and paperwork included, not just driving.',
    remedy: 'restart_34',
    remedyLabel: '34-hour restart',
    clock: 'cycle',
    limitValue: 70,
    unit: 'h',
  },
  'BR-19': {
    ruleId: 'BR-19',
    name: 'Fuel interval',
    limit: '1,000 miles',
    what: 'The trip runs more than 1,000 miles without a fuel stop.',
    why: 'The planner schedules refuelling every 1,000 miles as a policy constant, independent of duty status.',
    remedy: 'fuel',
    remedyLabel: '30-minute fuel stop',
    clock: 'distance',
    limitValue: 1000,
    unit: 'mi',
  },
};

export interface ClockReading {
  /** How much of the clock was already used before the blocked increment. */
  used: number;
  /** How much was left at the moment of the block. */
  remaining: number;
  /** The increment the engine tried to add. */
  attempted: number;
  /** Where the total would have landed. */
  projected: number;
  unit: 'h' | 'mi';
}

/**
 * Recover the clock numbers from the engine's message.
 *
 * Matches the two figures every blocking message contains — the proposed
 * increment and the projected total — and derives the rest from the rule's
 * known limit. Returns null rather than guessing if the shape does not match.
 */
export function readClock(message: string, rule: RuleExplanation): ClockReading | null {
  // "Driving 20h would bring … to 23.25h" / "Driving 1200 miles … to 1500 miles"
  const numbers = message.match(/(\d+(?:\.\d+)?)/g);
  if (!numbers || numbers.length < 2) return null;

  const attempted = Number(numbers[0]);
  const projected = Number(numbers[1]);
  if (!Number.isFinite(attempted) || !Number.isFinite(projected)) return null;
  // The projected total must exceed the increment, or this is not the shape we
  // think it is (e.g. the "already exhausted" cycle message, which has one).
  if (projected < attempted) return null;

  const used = projected - attempted;
  return {
    used: Math.max(used, 0),
    remaining: Math.max(rule.limitValue - used, 0),
    attempted,
    projected,
    unit: rule.unit,
  };
}

export function explanationFor(ruleId: string | undefined): RuleExplanation | null {
  if (!ruleId) return null;
  return RULE_EXPLANATIONS[ruleId] ?? null;
}

/** Label for the remedy a rule requires, for the activity log. */
export function remedyLabelFor(ruleId: string | undefined): string | null {
  return explanationFor(ruleId)?.remedyLabel ?? null;
}
