/**
 * Location input with suggestions.
 *
 * Implements the WAI-ARIA combobox pattern: the input keeps focus at all times
 * and `aria-activedescendant` points at the highlighted option, so arrow keys
 * move through the list without focus ever leaving the field. That is what lets
 * a user keep typing mid-navigation.
 *
 * Free text is always allowed. A dispatcher may need a yard or a street address
 * that no suggestion list contains, so the field never forces a selection —
 * suggestions are an accelerator, not a constraint.
 *
 * Keyboard: ↓/↑ move · Enter selects the highlight (or submits if none) ·
 * Escape closes then clears · Home/End jump · Tab closes and keeps the text.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Clock, MapPin, Search, X } from 'lucide-react';
import { REMOTE_ENABLED } from '../lib/geocoding';
import type { LocationSuggestion } from '../lib/geocoding';
import { useLocationSearch } from '../hooks/useLocationSearch';
import { Spinner } from './ui/Spinner';

interface LocationComboboxProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Fired when a suggestion is chosen, with its coordinates. */
  onSelect?: (suggestion: LocationSuggestion) => void;
  placeholder?: string;
  hint?: ReactNode;
  errors?: string[];
  required?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  /** Shown when the field is focused and empty. */
  recents?: LocationSuggestion[];
}

export function LocationCombobox({
  id,
  label,
  value,
  onChange,
  onSelect,
  placeholder,
  hint,
  errors,
  required,
  disabled,
  icon,
  recents = [],
}: LocationComboboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  /** Suppresses the lookup that a programmatic fill would otherwise trigger. */
  const [justSelected, setJustSelected] = useState(false);

  const wrapper = useRef<HTMLDivElement>(null);
  const listId = `${id}-listbox`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  const reactId = useId();

  const { suggestions, loading, empty, reset } = useLocationSearch(
    value,
    open && !justSelected && !disabled,
  );

  // With an empty field, offer recents instead of searching for nothing.
  const showRecents = open && value.trim().length === 0 && recents.length > 0;
  const options = useMemo(
    () => (showRecents ? recents : suggestions),
    [showRecents, recents, suggestions],
  );

  const hasError = Boolean(errors?.length);

  // Reset the highlight whenever the option set changes, so Enter can never
  // select a row that has scrolled out from under the index.
  useEffect(() => setActiveIndex(-1), [options]);

  // Close on an outside click. Pointerdown rather than click so the list is
  // gone before a click elsewhere lands.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function choose(suggestion: LocationSuggestion) {
    onChange(suggestion.label);
    onSelect?.(suggestion);
    setJustSelected(true);
    setOpen(false);
    setActiveIndex(-1);
    reset();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      if (open) {
        setOpen(false);
        setActiveIndex(-1);
      } else if (value) {
        onChange('');
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (options.length === 0) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => {
        const next = current + delta;
        if (next < 0) return options.length - 1;
        if (next >= options.length) return 0;
        return next;
      });
      return;
    }

    if (event.key === 'Home' && open && options.length > 0) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End' && open && options.length > 0) {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      return;
    }

    if (event.key === 'Enter') {
      // Only intercept Enter when a suggestion is highlighted; otherwise let it
      // submit the form, which is what a fast typist expects.
      if (open && activeIndex >= 0 && options[activeIndex]) {
        event.preventDefault();
        choose(options[activeIndex]);
      }
      return;
    }

    if (event.key === 'Tab' && open) setOpen(false);
  }

  const activeId = activeIndex >= 0 ? `${reactId}-option-${activeIndex}` : undefined;

  return (
    <div className="flex flex-col gap-1.5" ref={wrapper}>
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
        {required && (
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
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? errorId : hint ? hintId : undefined}
          value={value}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value);
            setJustSelected(false);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className={[
            'min-h-11 w-full rounded-lg border bg-white text-sm text-slate-900',
            'py-2.5 transition-colors placeholder:text-slate-400',
            icon ? 'pl-10' : 'pl-3',
            value ? 'pr-16' : 'pr-10',
            hasError
              ? 'border-red-500 hover:border-red-600'
              : 'border-gray-200 hover:border-slate-300',
            'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
          ].join(' ')}
        />

        {/* Trailing controls: spinner while searching, clear when there is text. */}
        <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {loading && (
            <span className="px-1 text-blue-600">
              <Spinner size="sm" label={null} />
            </span>
          )}
          {value && !disabled && (
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Clear ${label.toLowerCase()}`}
              title={`Clear ${label.toLowerCase()}`}
              onClick={() => {
                onChange('');
                reset();
                setOpen(false);
                document.getElementById(id)?.focus();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </span>

        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label={`${label} suggestions`}
            className="absolute z-40 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
          >
            {showRecents && (
              <li
                role="presentation"
                className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400"
              >
                Recent
              </li>
            )}

            {options.map((option, index) => (
              <li
                key={option.id}
                id={`${reactId}-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                // Pointerdown, not click: mousedown would blur the input first.
                onPointerDown={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
                onPointerEnter={() => setActiveIndex(index)}
                className={[
                  'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm',
                  index === activeIndex ? 'bg-blue-50 text-blue-900' : 'text-slate-700',
                ].join(' ')}
              >
                <span aria-hidden="true" className="shrink-0 text-slate-400">
                  {showRecents ? <Clock className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{option.city}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {[option.region, option.country].filter(Boolean).join(', ')}
                  </span>
                </span>
              </li>
            ))}

            {!showRecents && loading && options.length === 0 && (
              <li
                role="presentation"
                className="flex items-center gap-2 px-3 py-3 text-sm text-slate-500"
              >
                <span className="text-blue-600">
                  <Spinner size="sm" label={null} />
                </span>
                Searching…
              </li>
            )}

            {!showRecents && empty && (
              <li role="presentation" className="px-3 py-3 text-sm text-slate-500">
                <span className="flex items-center gap-2 font-medium text-slate-700">
                  <Search aria-hidden="true" className="h-4 w-4 text-slate-400" />
                  No results
                </span>
                <span className="mt-1 block text-xs leading-relaxed">
                  Nothing matched “{value.trim()}”. You can still type the location in full — try
                  adding the state, for example “Springfield, IL”.
                </span>
              </li>
            )}
          </ul>
        )}
      </div>

      {/* Result count for screen readers, without stealing focus. */}
      <span id={statusId} role="status" aria-live="polite" className="sr-only">
        {open && !loading && options.length > 0
          ? `${options.length} suggestion${options.length === 1 ? '' : 's'} available`
          : ''}
        {empty ? 'No results' : ''}
      </span>

      {hint && !hasError && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
          {!REMOTE_ENABLED && ' · suggestions from a built-in city list'}
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
