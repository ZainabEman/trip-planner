import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: 'primary' | 'secondary';
  /** Renders a spinner and disables the button. */
  loading?: boolean;
  children: ReactNode;
}

const VARIANTS = {
  primary:
    'bg-sky-500 text-white hover:bg-sky-400 focus-visible:ring-sky-400 disabled:hover:bg-sky-500',
  secondary:
    'bg-slate-800 text-slate-200 hover:bg-slate-700 focus-visible:ring-slate-500 disabled:hover:bg-slate-800',
} as const;

export function Button({
  variant = 'primary',
  loading = false,
  disabled,
  children,
  ...buttonProps
}: ButtonProps) {
  return (
    <button
      {...buttonProps}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5',
        'text-sm font-semibold transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
      ].join(' ')}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}
