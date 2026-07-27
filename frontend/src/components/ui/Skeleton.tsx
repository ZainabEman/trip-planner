/**
 * Loading placeholders.
 *
 * Preferred over a spinner wherever the shape of the incoming content is known:
 * the page does not reflow when data lands, and the user can see what is coming.
 * A spinner is still right for an action with no predictable shape (a submit
 * button, a re-plan).
 *
 * Each skeleton block is `aria-hidden`; the container announces the wait once
 * via a live region, so a screen reader hears "Loading trips" rather than a
 * stream of empty boxes.
 */
import type { ReactNode } from 'react';

interface SkeletonProps {
  /** Tailwind sizing classes, e.g. `h-4 w-32`. */
  className?: string;
  /** Render as a circle, for avatar/icon placeholders. */
  circle?: boolean;
}

export function Skeleton({ className = 'h-4 w-full', circle = false }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={[
        'block animate-pulse bg-slate-100',
        circle ? 'rounded-full' : 'rounded',
        className,
      ].join(' ')}
    />
  );
}

interface SkeletonRegionProps {
  /** Announced to assistive technology while loading. */
  label: string;
  children: ReactNode;
}

/** Wraps a set of skeletons so the wait is announced exactly once. */
export function SkeletonRegion({ label, children }: SkeletonRegionProps) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
