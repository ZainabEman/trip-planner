/**
 * Expandable section, used for timeline event details, FAQ answers, and the
 * "Show technical details" block on errors.
 *
 * Built on native `<details>`/`<summary>`: keyboard operable, screen-reader
 * announced and open/closed without any JavaScript state. A custom chevron
 * replaces the default marker.
 */
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface DisclosureProps {
  /** The always-visible trigger text. */
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Compact styling for inline use inside a timeline row. */
  size?: 'sm' | 'md';
}

export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  size = 'md',
}: DisclosureProps) {
  const isSmall = size === 'sm';

  return (
    <details open={defaultOpen} className="group">
      <summary
        className={[
          'flex cursor-pointer list-none items-center gap-1.5 font-medium text-slate-600',
          'hover:text-slate-900',
          // Keeps the trigger a comfortable tap target without a heavy look.
          isSmall ? 'min-h-8 text-xs' : 'min-h-11 text-sm',
          '[&::-webkit-details-marker]:hidden',
        ].join(' ')}
      >
        <ChevronDown
          aria-hidden="true"
          className={[
            'shrink-0 transition-transform duration-150 group-open:rotate-180',
            isSmall ? 'h-3.5 w-3.5' : 'h-4 w-4',
          ].join(' ')}
        />
        {summary}
      </summary>
      <div className={isSmall ? 'pt-2' : 'pt-3'}>{children}</div>
    </details>
  );
}
