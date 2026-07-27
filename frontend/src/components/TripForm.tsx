/**
 * The trip entry form — one screen, five inputs, one button.
 *
 * Client-side checks are deliberately minimal: required-ness and obvious range
 * problems only. The backend owns the business rules, and a cycle at or above
 * 70 hours is a *valid* input (the engine inserts a 34-hour restart rather than
 * rejecting it, per docs/api.md), so anything more would risk the form
 * disagreeing with the server.
 *
 * Server-side field errors arrive via `fieldErrors` and merge with local ones,
 * so the messages shown are the API's own strings.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { CalendarClock, Circle, Flag, Gauge, MapPin, Play } from 'lucide-react';
import type { FieldErrors } from '../lib/apiClient';
import type { CreateTripPayload } from '../types/api';
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

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!current.trim()) errors.current_location_text = ['Enter where the truck is now.'];
    if (!pickup.trim()) errors.pickup_location_text = ['Enter the pickup location.'];
    if (!dropoff.trim()) errors.dropoff_location_text = ['Enter the delivery location.'];
    if (!startTime) errors.trip_start_time = ['Choose when the trip starts.'];

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

  /** Local errors win — they were produced by the current, unsent input. */
  const errorsFor = (field: string): string[] | undefined =>
    localErrors[field] ?? fieldErrors[field];

  // Errors the API reported against a field this form does not render, so they
  // can never be silently swallowed.
  const unmapped = Object.entries(fieldErrors).filter(([field]) => !(field in FIELD_LABELS));

  return (
    <Card title="Plan a trip" description="Enter the route and the hours already used">
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <fieldset disabled={busy} className="space-y-5 border-0 p-0">
          <legend className="sr-only">Trip details</legend>

          <div className="grid gap-4 lg:grid-cols-3">
            <TextField
              id="current_location_text"
              label={FIELD_LABELS.current_location_text}
              placeholder="Dallas, TX"
              autoComplete="off"
              required
              icon={<Circle className={ICON} />}
              value={current}
              errors={errorsFor('current_location_text')}
              onChange={(event) => setCurrent(event.target.value)}
            />
            <TextField
              id="pickup_location_text"
              label={FIELD_LABELS.pickup_location_text}
              placeholder="Fort Worth, TX"
              autoComplete="off"
              required
              icon={<MapPin className={ICON} />}
              value={pickup}
              errors={errorsFor('pickup_location_text')}
              onChange={(event) => setPickup(event.target.value)}
            />
            <TextField
              id="dropoff_location_text"
              label={FIELD_LABELS.dropoff_location_text}
              placeholder="Oklahoma City, OK"
              autoComplete="off"
              required
              icon={<Flag className={ICON} />}
              value={dropoff}
              errors={errorsFor('dropoff_location_text')}
              onChange={(event) => setDropoff(event.target.value)}
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
              <Button type="submit" size="lg" loading={busy} fullWidth>
                {!busy && <Play aria-hidden="true" className="h-4 w-4" />}
                {submitLabel}
              </Button>
            </div>
          </div>
        </fieldset>

        {unmapped.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-red-50 p-3">
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
