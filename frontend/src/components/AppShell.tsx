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

      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white">
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

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
          <p className="text-xs leading-relaxed text-slate-500">
            Planning projections based on 49 CFR Part 395. This tool is a planning aid, not an
            Electronic Logging Device, and its output is not an official record of duty status.
            Always verify against your ELD and carrier policy.
          </p>
        </div>
      </footer>
    </div>
  );
}
