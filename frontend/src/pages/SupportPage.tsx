/**
 * Support and troubleshooting.
 *
 * "How planning works" is a short pipeline description rather than a diagram —
 * knowing that routing happens before rule-checking is what makes the error
 * messages interpretable.
 */
import { AlertCircle, ArrowRight, Bug, HelpCircle, Workflow } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Disclosure } from '../components/ui/Disclosure';
import { PageHeader } from '../components/ui/PageHeader';
import { ROUTES } from '../hooks/useHashRoute';

const PIPELINE = [
  { step: 'Trip saved', detail: 'Your five inputs are stored and given a trip ID.' },
  {
    step: 'Locations found',
    detail: 'Each place name is looked up on the map to get coordinates.',
  },
  {
    step: 'Route computed',
    detail: 'Two legs are measured: current → pickup (deadhead), pickup → delivery (loaded).',
  },
  {
    step: 'Rules applied',
    detail: 'Driving time is checked against the 11-hour, 14-hour, break, cycle and fuel limits.',
  },
  {
    step: 'Timeline built',
    detail: 'A gap-free schedule is produced from trip start to delivery, and saved.',
  },
];

const TROUBLESHOOTING = [
  {
    problem: 'Location not found',
    fix: 'Add the state or province — “Springfield, IL” rather than “Springfield”. Very small places may not be in the map data; try the nearest town.',
  },
  {
    problem: 'Trip cannot be completed legally',
    fix: 'Usually the delivery is too far for one duty period. Try a closer delivery, reduce the cycle hours already used, or plan the trip in two stages with a 10-hour reset between them.',
  },
  {
    problem: 'Mapping service unavailable',
    fix: 'The routing provider is rate-limited or briefly down. Wait a moment and press Try again — your trip is already saved, so nothing is lost.',
  },
  {
    problem: 'Cannot reach the server',
    fix: 'The planner could not connect. Check your network. If you are running this locally, confirm the backend is started and reachable on its configured address.',
  },
  {
    problem: 'Arrival time looks too late',
    fix: 'Total duration includes the pre-trip inspection, an hour to load, an hour to unload, the post-trip inspection, and any required breaks or rest — not just driving. Check the timeline to see where the time goes.',
  },
  {
    problem: 'The map is blank',
    fix: 'Map tiles come from OpenStreetMap and need network access. Markers may still be shown without a route line if the provider returned no geometry.',
  },
];

export function SupportPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Support"
        intro="How planning works, what to do when something goes wrong, and how to report a problem."
      />

      <Card title="How planning works">
        <ol className="space-y-3">
          {PIPELINE.map((item, index) => (
            <li key={item.step} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700"
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{item.step}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{item.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-600">
          <Workflow aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <span>
            Because rules are applied <em>after</em> the route is computed, a legality failure
            always means the route itself was fine — the schedule was the problem.
          </span>
        </p>
      </Card>

      <Card title="Common troubleshooting">
        <ul className="divide-y divide-gray-100">
          {TROUBLESHOOTING.map((item) => (
            <li key={item.problem} className="py-1 first:pt-0 last:pb-0">
              <Disclosure
                summary={
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                    <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-600" />
                    {item.problem}
                  </span>
                }
              >
                <p className="max-w-2xl pb-3 pl-6 text-sm leading-relaxed text-slate-600">
                  {item.fix}
                </p>
              </Disclosure>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Reporting an issue">
          <p className="text-sm leading-relaxed text-slate-600">
            The more of this you can include, the faster it can be diagnosed:
          </p>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {[
              'The Trip ID, shown under Trip details after planning.',
              'The exact three locations and the cycle hours you entered.',
              'The status code and API message from “Show technical details” on the error.',
              'What you expected to happen instead.',
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <Bug aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            Every failure response carries a status code and a message written to be quotable — copy
            it verbatim rather than paraphrasing.
          </p>
        </Card>

        <Card title="Still stuck?">
          <p className="text-sm leading-relaxed text-slate-600">
            Most questions about why a schedule looks the way it does are answered by the rules
            themselves.
          </p>
          <ul className="mt-4 space-y-2">
            <li>
              <a
                href={`#${ROUTES.hos}`}
                className="flex min-h-11 items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-800"
              >
                <HelpCircle aria-hidden="true" className="h-4 w-4" />
                Read the Hours of Service summary
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </a>
            </li>
            <li>
              <a
                href={`#${ROUTES.faq}`}
                className="flex min-h-11 items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-800"
              >
                <HelpCircle aria-hidden="true" className="h-4 w-4" />
                Browse the FAQ
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </a>
            </li>
          </ul>
          <p className="mt-5 border-t border-gray-200 pt-4 text-sm leading-relaxed text-slate-600">
            This tool projects what a driver <em>should</em> do. It does not record what a driver
            actually did, and it is not a substitute for your ELD.
          </p>
        </Card>
      </div>
    </div>
  );
}
