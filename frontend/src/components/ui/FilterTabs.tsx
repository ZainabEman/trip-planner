/**
 * Segmented filter control.
 *
 * A radio group rather than buttons: the options are mutually exclusive, and
 * this gives arrow-key navigation and correct screen-reader semantics for free.
 */
export interface FilterOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

interface FilterTabsProps<T extends string> {
  legend: string;
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function FilterTabs<T extends string>({
  legend,
  options,
  value,
  onChange,
}: FilterTabsProps<T>) {
  return (
    <fieldset className="border-0 p-0">
      <legend className="sr-only">{legend}</legend>
      <div className="inline-flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-slate-50 p-1">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={[
                'flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors',
                selected
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900',
              ].join(' ')}
            >
              <input
                type="radio"
                name={legend}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.label}
              {option.count !== undefined && (
                <span
                  className={[
                    'rounded-full px-1.5 text-xs tabular-nums',
                    selected ? 'bg-blue-50 text-blue-700' : 'bg-slate-200 text-slate-600',
                  ].join(' ')}
                >
                  {option.count}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
