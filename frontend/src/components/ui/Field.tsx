/**
 * Labelled form controls.
 *
 * Each renders its own error text, so a caller only has to hand it the
 * messages the API returned for that field — see TripForm. Presentation only:
 * no validation logic lives here.
 */
import type { InputHTMLAttributes, ReactNode } from 'react';

interface FieldShellProps {
  id: string;
  label: string;
  hint?: ReactNode;
  errors?: string[];
  children: ReactNode;
}

function FieldShell({ id, label, hint, errors, children }: FieldShellProps) {
  const hasError = Boolean(errors?.length);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-300">
        {label}
      </label>
      {children}
      {hint && !hasError && <p className="text-xs text-slate-500">{hint}</p>}
      {hasError && (
        <ul id={`${id}-error`} className="space-y-0.5" role="alert">
          {errors?.map((message) => (
            <li key={message} className="text-xs font-medium text-rose-400">
              {message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'className'
> {
  id: string;
  label: string;
  hint?: ReactNode;
  errors?: string[];
}

export function TextField({ id, label, hint, errors, ...inputProps }: TextFieldProps) {
  const hasError = Boolean(errors?.length);

  return (
    <FieldShell id={id} label={label} hint={hint} errors={errors}>
      <input
        {...inputProps}
        id={id}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? `${id}-error` : undefined}
        className={[
          'w-full rounded-lg border bg-slate-900/60 px-3 py-2 text-sm text-slate-100',
          'placeholder:text-slate-600 transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-sky-500/40',
          hasError
            ? 'border-rose-500/70 focus:border-rose-400'
            : 'border-slate-700 focus:border-sky-500',
          'disabled:cursor-not-allowed disabled:opacity-50',
          // Force the native calendar/clock pickers to render legibly on a dark field.
          '[color-scheme:dark]',
        ].join(' ')}
      />
    </FieldShell>
  );
}
