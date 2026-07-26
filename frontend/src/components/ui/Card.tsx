import type { ReactNode } from 'react';

interface CardProps {
  title?: string;
  /** Rendered at the top-right of the header — a badge, count, or action. */
  action?: ReactNode;
  /** Drop the inner padding, for flush content like a map. */
  flush?: boolean;
  children: ReactNode;
}

export function Card({ title, action, flush = false, children }: CardProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50 shadow-lg shadow-black/20">
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-3.5">
          {title && <h2 className="text-sm font-semibold tracking-wide text-slate-200">{title}</h2>}
          {action}
        </header>
      )}
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}
