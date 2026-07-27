/**
 * Application chrome: skip link, header nav, and footer.
 *
 * Navigation is a real `<nav>` of anchors rather than buttons, so hover-preview,
 * middle-click and bookmarking all behave the way a user expects.
 */
import type { ReactNode } from 'react';
import { Truck } from 'lucide-react';
import { ROUTES, hrefFor } from '../hooks/useHashRoute';
import type { RouteKey } from '../hooks/useHashRoute';
import { APP_CONTEXT, APP_NAME, BUILT_BY, REGULATION, TECH_STACK } from '../lib/appInfo';

type NavKey = keyof typeof ROUTES;

const NAV_ITEMS: { key: NavKey; label: string; short: string }[] = [
  { key: 'dashboard', label: 'Dashboard', short: 'Home' },
  { key: 'planner', label: 'Planner', short: 'Plan' },
  { key: 'history', label: 'History', short: 'History' },
  { key: 'hos', label: 'Hours of Service', short: 'HOS' },
  { key: 'faq', label: 'FAQ', short: 'FAQ' },
  { key: 'support', label: 'Support', short: 'Help' },
];

interface AppShellProps {
  route: RouteKey;
  children: ReactNode;
}

export function AppShell({ route, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-blue-700 focus:shadow-md"
      >
        Skip to main content
      </a>

      <header className="no-print sticky top-0 z-30 border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between gap-4">
            <a
              href={hrefFor('dashboard')}
              className="flex shrink-0 items-center gap-2.5 text-slate-900"
              aria-label="Truck Trip Planner — dashboard"
            >
              <span
                aria-hidden="true"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white"
              >
                <Truck className="h-5 w-5" />
              </span>
              <span className="text-base font-semibold tracking-tight">Trip Planner</span>
            </a>

            <nav aria-label="Main" className="min-w-0">
              {/* Scrolls rather than wraps on narrow screens, so the header
                  stays one row and the page never scrolls sideways. */}
              <ul className="flex items-center gap-0.5 overflow-x-auto">
                {NAV_ITEMS.map((item) => {
                  // A trip details page is part of the history section.
                  const isCurrent =
                    item.key === route || (item.key === 'history' && route === 'trip');
                  return (
                    <li key={item.key}>
                      <a
                        href={hrefFor(item.key)}
                        aria-current={isCurrent ? 'page' : undefined}
                        className={[
                          'flex min-h-11 items-center whitespace-nowrap rounded-lg px-2.5 text-sm font-medium transition-colors sm:px-3',
                          isCurrent
                            ? 'bg-blue-50 text-blue-700'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                        ].join(' ')}
                      >
                        <span className="md:hidden">{item.short}</span>
                        <span className="hidden md:inline">{item.label}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>

      <footer className="no-print border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-6">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-slate-900">
                <Truck aria-hidden="true" className="h-4 w-4 text-blue-600" />
                {APP_NAME}
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <span className="font-medium text-slate-600">{APP_CONTEXT}</span>
              </p>
              <p className="mt-1.5 text-xs text-slate-500">
                Built by <span className="font-medium text-slate-700">{BUILT_BY}</span>
              </p>
            </div>

            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Powered by
              </p>
              <ul className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                {TECH_STACK.map((tech) => (
                  <li key={tech.label}>
                    <a
                      href={tech.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex min-h-8 items-center rounded-md border border-gray-200 px-2 text-xs font-medium text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-700"
                    >
                      {tech.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="mt-6 border-t border-gray-100 pt-4 text-xs leading-relaxed text-slate-500">
            Planning projections based on {REGULATION}. This tool is a planning aid, not an
            Electronic Logging Device, and its output is not an official record of duty status.
            Always verify against your ELD and carrier policy.
          </p>
        </div>
      </footer>
    </div>
  );
}
