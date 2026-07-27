import type { ReactNode } from 'react';

interface CardProps {
  title?: string;
  description?: string;
  /** Rendered at the top-right of the header — a badge, count, or legend. */
  action?: ReactNode;
  /** Drop the inner padding, for flush content like a map. */
  flush?: boolean;
  /** Accessible label when the card is a landmark without a visible title. */
  ariaLabel?: string;
  children: ReactNode;
}

export function Card({ title, description, action, flush, ariaLabel, children }: CardProps) {
  const headingId = title ? `card-${title.replace(/\s+/g, '-').toLowerCase()}` : undefined;

  return (
    <section
      aria-labelledby={headingId}
      aria-label={headingId ? undefined : ariaLabel}
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-gray-200 px-5 py-4">
          <div className="min-w-0">
            {title && (
              <h2 id={headingId} className="text-base font-semibold text-slate-900">
                {title}
              </h2>
            )}
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}
