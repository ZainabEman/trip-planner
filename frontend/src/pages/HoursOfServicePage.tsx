/**
 * Plain-language reference for the five rules the planner enforces.
 *
 * Explanations come from `content/hosRules.ts` so this page, the timeline and
 * the error card cannot describe the same rule differently.
 */
import { Clock, RotateCcw, Timer } from 'lucide-react';
import { HOS_RULES } from '../content/hosRules';
import { Card } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';

const ICONS = [Clock, Timer, Timer, Clock, RotateCcw];

export function HoursOfServicePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Hours of Service"
        intro="Five federal limits shape every trip this planner builds. Here is what each one means in plain terms — no legal language."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {HOS_RULES.map((rule, index) => {
          const Icon = ICONS[index] ?? Clock;
          return (
            <Card key={rule.id} ariaLabel={rule.name}>
              <div className="flex items-start gap-4">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"
                >
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <h2 className="text-base font-semibold text-slate-900">{rule.name}</h2>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-medium text-slate-600">
                      {rule.id}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-blue-700">{rule.limit}</p>

                  <dl className="mt-3 space-y-2.5 text-sm">
                    <div>
                      <dt className="text-xs font-medium text-slate-500">What it means</dt>
                      <dd className="mt-0.5 leading-relaxed text-slate-700">{rule.what}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-slate-500">Why it matters</dt>
                      <dd className="mt-0.5 leading-relaxed text-slate-700">{rule.why}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-slate-500">How it resets</dt>
                      <dd className="mt-0.5 leading-relaxed text-slate-700">{rule.resets}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card ariaLabel="Scope note">
        <h2 className="text-base font-semibold text-slate-900">What this planner does not cover</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-700">
          <li>
            <strong className="font-semibold">Sleeper-berth splits.</strong> Rest is planned as a
            single continuous block, not split between the berth and off duty.
          </li>
          <li>
            <strong className="font-semibold">Adverse driving conditions.</strong> The two-hour
            extension for weather or traffic is not applied.
          </li>
          <li>
            <strong className="font-semibold">Short-haul and other exceptions.</strong> Every trip
            is planned under the standard property-carrying rules.
          </li>
          <li>
            <strong className="font-semibold">Team drivers.</strong> One driver per trip.
          </li>
        </ul>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">
          Always confirm against your ELD and your carrier&apos;s policy. This is a planning aid,
          not a compliance record.
        </p>
      </Card>
    </div>
  );
}
