const SIZES = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-10 w-10 border-[3px]',
} as const;

interface SpinnerProps {
  size?: keyof typeof SIZES;
  label?: string;
}

export function Spinner({ size = 'md', label }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label ?? 'Loading'}
      className={[
        'inline-block animate-spin rounded-full',
        'border-current border-t-transparent opacity-80',
        SIZES[size],
      ].join(' ')}
    />
  );
}
