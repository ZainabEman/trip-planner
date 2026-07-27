/**
 * FAQ, as a list of native disclosures so answers are keyboard-operable and
 * findable with the browser's in-page search when expanded.
 */
import type { ReactNode } from 'react';
import { Card } from '../components/ui/Card';
import { Disclosure } from '../components/ui/Disclosure';
import { PageHeader } from '../components/ui/PageHeader';

interface Faq {
  question: string;
  answer: ReactNode;
}

const FAQS: Faq[] = [
  {
    question: 'What is Hours of Service?',
    answer: (
      <>
        Hours of Service (HOS) is the set of federal rules in 49 CFR Part 395 that limit how long a
        commercial driver may drive and work before taking rest. They exist to keep tired drivers
        off the road. This planner applies those limits to your route so the schedule it produces is
        legal before the truck moves.
      </>
    ),
  },
  {
    question: 'What is the 11-hour rule?',
    answer: (
      <>
        You may drive a maximum of <strong>11 hours</strong> after coming on duty. Once you hit 11
        hours of driving, you need 10 consecutive hours off duty before you can drive again. Time
        spent loading, fuelling or waiting does not count against this one — only actual driving.
      </>
    ),
  },
  {
    question: 'What is the 14-hour rule?',
    answer: (
      <>
        From the moment you come on duty, you have a <strong>14-hour window</strong> in which all of
        your driving must happen. The important part: this clock does not stop. A two-hour wait at a
        dock still burns two hours of your window. After 14 hours you may finish non-driving work —
        paperwork, unloading — but you may not drive until you have taken 10 hours off.
      </>
    ),
  },
  {
    question: 'Why do I need a 30-minute break?',
    answer: (
      <>
        After <strong>8 cumulative hours of driving</strong> without a break of at least 30 minutes,
        you must stop driving until you have taken one. &ldquo;Cumulative&rdquo; matters: the 8
        hours add up across your day and do not need to be consecutive. The break can be off duty,
        in the sleeper berth, or on duty not driving — a 30-minute fuel stop can satisfy it.
      </>
    ),
  },
  {
    question: 'What is the 70-hour cycle?',
    answer: (
      <>
        Your total <strong>on-duty</strong> time across any 8 consecutive days cannot exceed 70
        hours. This counts everything on duty, not just driving — inspections, loading, paperwork
        and waiting all draw it down. When you run out, only a 34-hour restart gets it back.
      </>
    ),
  },
  {
    question: 'What is a 34-hour restart?',
    answer: (
      <>
        Taking <strong>34 consecutive hours off duty</strong> resets your 70-hour cycle to zero. If
        you enter a trip with 70 hours already used, the planner inserts the restart before any
        driving and shifts your arrival accordingly — you will see it as the first event on the
        timeline.
      </>
    ),
  },
  {
    question: 'Why did planning fail?',
    answer: (
      <>
        The planner never returns an illegal schedule. If no legal schedule exists, it tells you
        which rule blocked it instead. The most common cause is a delivery too far to reach inside
        the 14-hour window in one duty period. The error card names the rule (for example{' '}
        <span className="font-mono text-xs">BR-2</span>) and suggests what to change. Other causes
        are a location that cannot be found on the map, or no drivable road route between two
        points.
      </>
    ),
  },
  {
    question: 'How are driving hours calculated?',
    answer: (
      <>
        Driving time comes from the routing provider&apos;s estimate for each leg at normal road
        speed. The planner then adds the fixed on-duty periods every trip has — 15 minutes for the
        pre-trip inspection, 1 hour to load, 1 hour to unload, 15 minutes for the post-trip
        inspection — and inserts any breaks or rest the rules require. That is why{' '}
        <strong>total duration</strong> is longer than <strong>driving hours</strong> in the
        summary.
      </>
    ),
  },
  {
    question: 'Why are all the times in UTC?',
    answer: (
      <>
        The schedule is computed in UTC, and the timeline shows it that way so the timestamps always
        agree with the duty-hour totals in the summary. Your trip start is entered in your local
        time and converted for you.
      </>
    ),
  },
  {
    question: 'Can I edit a trip after planning it?',
    answer: (
      <>
        Trips are regenerated rather than edited. Change the inputs and generate again — you get a
        fresh route and timeline, and the previous plan is replaced. This keeps a plan internally
        consistent instead of leaving a half-updated schedule behind.
      </>
    ),
  },
];

export function FaqPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Frequently asked questions"
        intro="How the planner works and what the hours-of-service rules mean for your trip."
      />

      <Card ariaLabel="Questions and answers">
        <ul className="divide-y divide-gray-100">
          {FAQS.map((faq) => (
            <li key={faq.question} className="py-1 first:pt-0 last:pb-0">
              <Disclosure
                summary={
                  <span className="text-base font-medium text-slate-900">{faq.question}</span>
                }
              >
                <p className="max-w-2xl pb-3 text-sm leading-relaxed text-slate-600">
                  {faq.answer}
                </p>
              </Disclosure>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
