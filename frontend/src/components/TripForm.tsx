/**
 * The trip entry form — three locations, cycle hours, start time, one button.
 *
 * Locations use a combobox with suggestions rather than a bare text field.
 * Typing a bare state name is the single most common way to get a "no drivable
 * route" failure from the backend (the geocoder returns a rural centroid the
 * router cannot snap to), so steering the user toward a real city is a
 * correctness feature, not just convenience.
 *
 * Client-side checks stay minimal: required-ness and obvious range problems
 * only. The backend owns the business rules — a cycle at or above 70 hours is
 * *valid* input, and the engine responds by inserting a 34-hour restart — so
 * anything more would risk the form disagreeing with the server. Server-side
 * field errors arrive via `fieldErrors` and merge with local ones.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpDown, CalendarClock, Circle, Flag, Gauge, MapPin, Play } from 'lucide-react';
import type { FieldErrors } from '../lib/apiClient';
import type { LocationSuggestion } from '../lib/geocoding';
import { useRecentLocations } from '../hooks/useRecentLocations';
import type { CreateTripPayload } from '../types/api';
import { LocationCombobox } from './LocationCombobox';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { TextField } from './ui/Field';

interface TripFormProps {
  onSubmit: (payload: CreateTripPayload) => void;
  busy: boolean;
  /** Field-scoped messages returned by the API, keyed by field name. */
  fieldErrors?: FieldErrors;
  submitLabel: string;
}

/** `datetime-local` needs `YYYY-MM-DDTHH:mm`; default to the next whole hour. */
function defaultStartTime(): string {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

const FIELD_LABELS: Record<string, string> = {
  current_location_text: 'Current location',
  pickup_location_text: 'Pickup location',
  dropoff_location_text: 'Delivery location',
  cycle_hours_used: 'Cycle hours used',
  trip_start_time: 'Trip start',
};

const ICON = 'h-4 w-4';

export function TripForm({ onSubmit, busy, fieldErrors = {}, submitLabel }: TripFormProps) {
  const [current, setCurrent] = useState('');
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [cycleHours, setCycleHours] = useState('0');
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [localErrors, setLocalErrors] = useState<FieldErrors>({});

  const { recents, remember } = useRecentLocations();

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!current.trim()) errors.current_location_text = ['Enter where the truck is now.'];
    if (!pickup.trim()) errors.pickup_location_text = ['Enter the pickup location.'];
    if (!dropoff.trim()) errors.dropoff_location_text = ['Enter the delivery location.'];
    if (!startTime) errors.trip_start_time = ['Choose when the trip starts.'];

    // Same origin and destination cannot produce a route; catching it here
    // saves a round-trip and two geocoding calls.
    if (
      pickup.trim() &&
      dropoff.trim() &&
      pickup.trim().toLowerCase() === dropoff.trim().toLowerCase()
    ) {
      errors.dropoff_location_text = ['Delivery must differ from the pickup.'];
    }

    const hours = Number(cycleHours);
    if (cycleHours === '' || Number.isNaN(hours)) {
      errors.cycle_hours_used = ['Enter a number of hours.'];
    } else if (hours < 0) {
      errors.cycle_hours_used = ['Hours cannot be negative.'];
    } else if (hours > 70) {
      errors.cycle_hours_used = ['Hours cannot be more than 70.'];
    }
    return errors;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Guard against a double submit racing past the disabled state.
    if (busy) return;

    const errors = validate();
    setLocalErrors(errors);
    if (Object.keys(errors).length > 0) {
      // Move focus to the first problem so a keyboard user is not left guessing.
      document.getElementById(Object.keys(errors)[0])?.focus();
      return;
    }

    onSubmit({
      current_location_text: current.trim(),
      pickup_location_text: pickup.trim(),
      dropoff_location_text: dropoff.trim(),
      cycle_hours_used: Number(cycleHours).toFixed(2),
      // `datetime-local` yields a naive local string; the API wants an instant.
      trip_start_time: new Date(startTime).toISOString(),
    });
  }

  function swapPickupAndDelivery() {
    setPickup(dropoff);
    setDropoff(pickup);
    setLocalErrors({});
  }

  /** Local errors win — they were produced by the current, unsent input. */
  const errorsFor = (field: string): string[] | undefined =>
    localErrors[field] ?? fieldErrors[field];

  const onLocationPicked =
    (setter: (value: string) => void) => (suggestion: LocationSuggestion) => {
      setter(suggestion.label);
      remember(suggestion);
    };

  // Errors the API reported against a field this form does not render, so they
  // can never be silently swallowed.
  const unmapped = Object.entries(fieldErrors).filter(([field]) => !(field in FIELD_LABELS));
  const errorCount = Object.keys(localErrors).length;

  return (
    <Card title="Plan a trip" description="Enter the route and the hours already used">
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <fieldset disabled={busy} className="space-y-5 border-0 p-0">
          <legend className="sr-only">Trip details</legend>

          <div className="grid gap-4 lg:grid-cols-3">
            <LocationCombobox
              id="current_location_text"
              label={FIELD_LABELS.current_location_text}
              placeholder="Start typing a city…"
              required
              icon={<Circle className={ICON} />}
              value={current}
              recents={recents}
              errors={errorsFor('current_location_text')}
              onChange={setCurrent}
              onSelect={onLocationPicked(setCurrent)}
            />

            {/* Pickup and delivery, with a swap control between them. */}
            <div className="relative">
              <LocationCombobox
                id="pickup_location_text"
                label={FIELD_LABELS.pickup_location_text}
                placeholder="Start typing a city…"
                required
                icon={<MapPin className={ICON} />}
                value={pickup}
                recents={recents}
                errors={errorsFor('pickup_location_text')}
                onChange={setPickup}
                onSelect={onLocationPicked(setPickup)}
              />
              <button
                type="button"
                onClick={swapPickupAndDelivery}
                disabled={busy || (!pickup && !dropoff)}
                title="Swap pickup and delivery"
                aria-label="Swap pickup and delivery locations"
                className="absolute -bottom-3 right-2 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40 lg:-right-5 lg:bottom-auto lg:top-8"
              >
                <ArrowUpDown aria-hidden="true" className="h-4 w-4 lg:rotate-90" />
              </button>
            </div>

            <LocationCombobox
              id="dropoff_location_text"
              label={FIELD_LABELS.dropoff_location_text}
              placeholder="Start typing a city…"
              required
              icon={<Flag className={ICON} />}
              value={dropoff}
              recents={recents}
              errors={errorsFor('dropoff_location_text')}
              onChange={setDropoff}
              onSelect={onLocationPicked(setDropoff)}
            />
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-3">
            <TextField
              id="cycle_hours_used"
              label={FIELD_LABELS.cycle_hours_used}
              type="number"
              min={0}
              max={70}
              step={0.25}
              inputMode="decimal"
              required
              icon={<Gauge className={ICON} />}
              hint="Of the 70-hour, 8-day cycle"
              value={cycleHours}
              errors={errorsFor('cycle_hours_used')}
              onChange={(event) => setCycleHours(event.target.value)}
            />
            <TextField
              id="trip_start_time"
              label={FIELD_LABELS.trip_start_time}
              type="datetime-local"
              required
              icon={<CalendarClock className={ICON} />}
              hint="Your local time; shown as UTC"
              value={startTime}
              errors={errorsFor('trip_start_time')}
              onChange={(event) => setStartTime(event.target.value)}
            />
            <div className="lg:pt-[26px]">
              <Button type="submit" size="lg" loading={busy} disabled={busy} fullWidth>
                {!busy && <Play aria-hidden="true" className="h-4 w-4" />}
                {submitLabel}
              </Button>
            </div>
          </div>
        </fieldset>

        {/* Summarised for screen readers; each field also shows its own message. */}
        {errorCount > 0 && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
          >
            {errorCount === 1
              ? 'One field needs attention before planning.'
              : `${errorCount} fields need attention before planning.`}
          </p>
        )}

        {unmapped.length > 0 && (
          <ul role="alert" className="space-y-1 rounded-lg bg-red-50 p-3">
            {unmapped.map(([field, messages]) => (
              <li key={field} className="text-xs font-medium text-red-700">
                <span className="font-mono">{field}</span>: {messages.join(' ')}
              </li>
            ))}
          </ul>
        )}
      </form>
    </Card>
  );
}
