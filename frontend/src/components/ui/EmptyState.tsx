import type { ReactNode } from 'react';
import { EmptyIllustration } from './EmptyIllustration';
import type { IllustrationName } from './EmptyIllustration';

interface EmptyStateProps {
  /** Line-art illustration. Preferred over `icon` for full-panel empties. */
  illustration?: IllustrationName;
  /** Small icon fallback, for empties nested in a tight panel. */
  icon?: ReactNode;
  title: string;
  description?: string;
  /** A primary action. Every empty state should offer the obvious next step. */
  action?: ReactNode;
  /** Secondary action, e.g. "Clear filters" beside "Plan a trip". */
  secondaryAction?: ReactNode;
  /** Reduce vertical padding for empty states nested inside a small panel. */
  compact?: boolean;
}

export function EmptyState({
  illustration,
  icon,
  title,
  description,
  action,
  secondaryAction,
  compact = false,
}: EmptyStateProps) {
  return (
    <div className={['text-center', compact ? 'px-4 py-8' : 'px-6 py-12'].join(' ')}>
      {illustration ? (
        <div className="flex justify-center">
          <EmptyIllustration name={illustration} />
        </div>
      ) : (
        icon && (
          <span
            aria-hidden="true"
            className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400"
          >
            {icon}
          </span>
        )
      )}

      <p className="mt-4 text-base font-semibold text-slate-900">{title}</p>
      {description && (
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-slate-500">
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
