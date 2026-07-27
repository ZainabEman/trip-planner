/**
 * Links to the reference pages.
 *
 * Extracted because the dashboard rendered this grid twice — once for the
 * populated state and once for the empty one — with copy that had already
 * drifted between the two. One component, one wording.
 */
import { ArrowRight } from 'lucide-react';
import { hrefFor } from '../hooks/useHashRoute';

const LINKS = [
  {
    key: 'hos' as const,
    title: 'Hours of Service',
    body: 'The five federal limits, in plain terms',
  },
  { key: 'faq' as const, title: 'FAQ', body: 'How planning works and why trips fail' },
  { key: 'support' as const, title: 'Support', body: 'Troubleshooting and how to report an issue' },
];

export function ReferenceLinks() {
  return (
    <nav aria-label="Reference" className="grid gap-4 sm:grid-cols-3">
      {LINKS.map((link) => (
        <a
          key={link.key}
          href={hrefFor(link.key)}
          className="group flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-colors hover:border-blue-300"
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900">{link.title}</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{link.body}</span>
          </span>
          <ArrowRight
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5"
          />
        </a>
      ))}
    </nav>
  );
}
