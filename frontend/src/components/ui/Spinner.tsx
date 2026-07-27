const SIZES = {
  sm: 'h-4 w-4 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-8 w-8 border-[3px]',
} as const;

interface SpinnerProps {
  size?: keyof typeof SIZES;
  /** Accessible name. Pass `null` when an adjacent live region already announces progress. */
  label?: string | null;
}

export function Spinner({ size = 'md', label = 'Loading' }: SpinnerProps) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-hidden={label ? undefined : 'true'}
      aria-label={label ?? undefined}
      className={[
        'inline-block shrink-0 animate-spin rounded-full',
        'border-current border-t-transparent',
        SIZES[size],
      ].join(' ')}
    />
  );
}
