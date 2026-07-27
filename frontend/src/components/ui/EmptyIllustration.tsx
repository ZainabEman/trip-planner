/**
 * Inline SVG illustrations for empty states.
 *
 * Drawn rather than imported: they must ship with no network request (the app is
 * used on flaky connections) and must inherit the palette. All are single-colour
 * line art in the neutral/brand greys, so they read as part of the interface
 * rather than as decoration.
 */
export type IllustrationName = 'trips' | 'search' | 'route' | 'timeline' | 'failed' | 'planned';

const STROKE = 1.5;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 120 84"
      role="img"
      aria-hidden="true"
      className="h-20 w-auto text-slate-300"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Common ground line, so every illustration sits on the same baseline. */}
      <path d="M14 70h92" className="text-slate-200" />
      {children}
    </svg>
  );
}

function Trips() {
  return (
    <Frame>
      <rect x="26" y="40" width="40" height="22" rx="3" />
      <path d="M66 46h14l10 10v6H66z" />
      <circle cx="40" cy="66" r="4" className="text-slate-400" />
      <circle cx="78" cy="66" r="4" className="text-slate-400" />
      <path d="M32 34h28" className="text-slate-200" />
    </Frame>
  );
}

function SearchGlass() {
  return (
    <Frame>
      <circle cx="54" cy="38" r="18" />
      <path d="M67 51l13 13" strokeWidth={2} />
      <path d="M46 38h16M46 44h10" className="text-slate-200" />
    </Frame>
  );
}

function RouteLine() {
  return (
    <Frame>
      <path d="M28 60C28 40 48 44 56 36s24-4 36-14" strokeDasharray="5 5" />
      <circle cx="28" cy="60" r="5" className="text-slate-400" />
      <circle cx="92" cy="22" r="5" className="text-slate-400" />
    </Frame>
  );
}

function TimelineBars() {
  return (
    <Frame>
      <path d="M34 24v38" className="text-slate-200" />
      <circle cx="34" cy="30" r="4" />
      <circle cx="34" cy="46" r="4" />
      <circle cx="34" cy="60" r="4" />
      <path d="M46 30h40M46 46h30M46 60h36" className="text-slate-200" />
    </Frame>
  );
}

function FailedShield() {
  return (
    <Frame>
      <path d="M60 20l20 8v16c0 12-9 20-20 24-11-4-20-12-20-24V28z" />
      <path d="M53 37l14 14M67 37L53 51" strokeWidth={2} className="text-slate-400" />
    </Frame>
  );
}

function PlannedCheck() {
  return (
    <Frame>
      <path d="M60 20l20 8v16c0 12-9 20-20 24-11-4-20-12-20-24V28z" />
      <path d="M51 42l7 7 12-13" strokeWidth={2} className="text-slate-400" />
    </Frame>
  );
}

const BY_NAME: Record<IllustrationName, () => React.JSX.Element> = {
  trips: Trips,
  search: SearchGlass,
  route: RouteLine,
  timeline: TimelineBars,
  failed: FailedShield,
  planned: PlannedCheck,
};

export function EmptyIllustration({ name }: { name: IllustrationName }) {
  const Drawing = BY_NAME[name];
  return <Drawing />;
}
