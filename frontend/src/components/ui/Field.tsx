/**
 * Labelled form controls.
 *
 * Each renders its own error text and wires `aria-describedby` to whichever of
 * the hint or the error is currently shown, so screen readers get the same
 * guidance sighted users do. Presentation only — no validation logic here.
 */
import type { InputHTMLAttributes, ReactNode } from 'react';

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'className'
> {
  id: string;
  label: string;
  hint?: ReactNode;
  errors?: string[];
  /** Rendered inside the input's leading edge. */
  icon?: ReactNode;
}

export function TextField({ id, label, hint, errors, icon, ...inputProps }: TextFieldProps) {
  const hasError = Boolean(errors?.length);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
        {inputProps.required && (
          <span aria-hidden="true" className="ml-0.5 text-red-600">
            *
          </span>
        )}
      </label>

      <div className="relative">
        {icon && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          >
            {icon}
          </span>
        )}
        <input
          {...inputProps}
          id={id}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? errorId : hint ? hintId : undefined}
          className={[
            // min-h-11 keeps the control at a 44px touch target.
            'min-h-11 w-full rounded-lg border bg-white text-sm text-slate-900',
            'py-2.5 pr-3 transition-colors placeholder:text-slate-400',
            icon ? 'pl-10' : 'pl-3',
            hasError
              ? 'border-red-500 hover:border-red-600'
              : 'border-gray-200 hover:border-slate-300',
            'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
          ].join(' ')}
        />
      </div>

      {hint && !hasError && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {hasError && (
        <ul id={errorId} className="space-y-0.5">
          {errors?.map((message) => (
            <li key={message} className="text-xs font-medium text-red-600">
              {message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
