/**
 * Plain-language descriptions of the rules the engine enforces.
 *
 * Single source for the explanations shown on the About HOS page, so the
 * wording cannot drift from what the error card and timeline say. Rule ids
 * match the BR numbers the API reports.
 */
export interface HosRule {
  id: string;
  name: string;
  limit: string;
  what: string;
  why: string;
  resets: string;
}

export const HOS_RULES: HosRule[] = [
  {
    id: 'BR-1',
    name: '11-hour driving limit',
    limit: '11 hours',
    what: 'You may drive at most 11 hours before you need 10 hours off duty.',
    why: 'It caps how long you are actually behind the wheel in one stretch of work.',
    resets: '10 consecutive hours off duty.',
  },
  {
    id: 'BR-2',
    name: '14-hour duty window',
    limit: '14 hours',
    what: 'Once you come on duty, you have 14 hours in which any driving must happen.',
    why: 'The clock keeps running whether you are driving, loading or waiting. Breaks do not pause it — that is what surprises people most.',
    resets: '10 consecutive hours off duty.',
  },
  {
    id: 'BR-4',
    name: '30-minute break',
    limit: 'After 8 hours driving',
    what: 'After 8 cumulative hours of driving you must take at least 30 minutes without driving.',
    why: 'It breaks up long stretches of driving. The 8 hours add up across the day — they do not have to be back to back.',
    resets: 'Any 30 minutes not driving: off duty, sleeper berth, or on duty not driving.',
  },
  {
    id: 'BR-8',
    name: '70-hour cycle',
    limit: '70 hours / 8 days',
    what: 'Your total on-duty time across any 8 consecutive days cannot exceed 70 hours.',
    why: 'This counts all on-duty time, not just driving — inspections, loading and paperwork all use it up.',
    resets: 'A 34-hour restart, or older days rolling out of the 8-day window.',
  },
  {
    id: 'BR-10',
    name: '34-hour restart',
    limit: '34 hours off',
    what: 'Taking 34 consecutive hours off duty sets your 70-hour cycle back to zero.',
    why: 'It is the way to get a full cycle back when you have run out of hours.',
    resets: 'Not applicable — this is the reset.',
  },
];
