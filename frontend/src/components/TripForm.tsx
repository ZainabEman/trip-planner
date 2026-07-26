/**
 * The four-input trip form.
 *
 * Client-side checks are deliberately minimal — required-ness and obvious range
 * problems only. The backend owns the business rules (and a cycle at or above
 * 70 hours is a *valid* input: the engine inserts a 34-hour restart rather than
 * rejecting it, per docs/api.md), so anything beyond basic shape validation
 * would risk the form disagreeing with the server.
 *
 * Server-side field errors arrive via `fieldErrors` and are merged with local
 * ones, which is what satisfies "show API validation errors using existing
 * error responses" — the messages rendered are the API's own strings.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
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
  /** Label for the submit button — reflects the current workflow phase. */
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
  dropoff_location_text: 'Dropoff location',
  cycle_hours_used: 'Cycle hours used',
  trip_start_time: 'Trip start',
};

export function TripForm({ onSubmit, busy, fieldErrors = {}, submitLabel }: TripFormProps) {
  const [current, setCurrent] = useState('');
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [cycleHours, setCycleHours] = useState('0');
  const [startTime, setStartTime] = useState(defaultStartTime);
  const [localErrors, setLocalErrors] = useState<FieldErrors>({});

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!current.trim()) errors.current_location_text = ['This field is required.'];
    if (!pickup.trim()) errors.pickup_location_text = ['This field is required.'];
    if (!dropoff.trim()) errors.dropoff_location_text = ['This field is required.'];
    if (!startTime) errors.trip_start_time = ['This field is required.'];

    const hours = Number(cycleHours);
    if (cycleHours === '' || Number.isNaN(hours)) {
      errors.cycle_hours_used = ['Enter a number of hours.'];
    } else if (hours < 0) {
      errors.cycle_hours_used = ['Cycle hours used cannot be negative.'];
    } else if (hours > 70) {
      errors.cycle_hours_used = ['Cycle hours used cannot exceed 70.'];
    }
    return errors;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors = validate();
    setLocalErrors(errors);
    if (Object.keys(errors).length > 0) return;

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
  const unmappedErrors = Object.entries(fieldErrors).filter(([field]) => !(field in FIELD_LABELS));

  return (
    <Card title="Plan a trip">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <TextField
          id="current_location_text"
          label={FIELD_LABELS.current_location_text}
          placeholder="Dallas, TX"
          autoComplete="off"
          value={current}
          disabled={busy}
          errors={errorsFor('current_location_text')}
          onChange={(event) => setCurrent(event.target.value)}
        />
        <TextField
          id="pickup_location_text"
          label={FIELD_LABELS.pickup_location_text}
          placeholder="Fort Worth, TX"
          autoComplete="off"
          value={pickup}
          disabled={busy}
          errors={errorsFor('pickup_location_text')}
          onChange={(event) => setPickup(event.target.value)}
        />
        <TextField
          id="dropoff_location_text"
          label={FIELD_LABELS.dropoff_location_text}
          placeholder="Oklahoma City, OK"
          autoComplete="off"
          value={dropoff}
          disabled={busy}
          errors={errorsFor('dropoff_location_text')}
          onChange={(event) => setDropoff(event.target.value)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="cycle_hours_used"
            label={FIELD_LABELS.cycle_hours_used}
            type="number"
            min={0}
            max={70}
            step={0.25}
            inputMode="decimal"
            hint="Hours already used in the 70-hour/8-day cycle"
            value={cycleHours}
            disabled={busy}
            errors={errorsFor('cycle_hours_used')}
            onChange={(event) => setCycleHours(event.target.value)}
          />
          <TextField
            id="trip_start_time"
            label={FIELD_LABELS.trip_start_time}
            type="datetime-local"
            hint="Your local time; sent as UTC"
            value={startTime}
            disabled={busy}
            errors={errorsFor('trip_start_time')}
            onChange={(event) => setStartTime(event.target.value)}
          />
        </div>

        {unmappedErrors.length > 0 && (
          <ul role="alert" className="space-y-1">
            {unmappedErrors.map(([field, messages]) => (
              <li key={field} className="text-xs font-medium text-rose-400">
                <span className="font-mono">{field}</span>: {messages.join(' ')}
              </li>
            ))}
          </ul>
        )}

        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
      </form>
    </Card>
  );
}
