/**
 * Shared status → colour mapping.
 *
 * Kept out of Badge.tsx so that file exports only its component (React Fast
 * Refresh degrades when a module mixes components with other exports), and
 * because the map and the timeline rail need the solid colours without
 * importing a badge.
 */
import type { DutyStatus, TripStatus } from '../types/api';

export type BadgeTone =
  | 'brand'
  | 'success'
  | 'warning'
  | 'danger'
  | 'neutral'
  | 'driving'
  | 'onDuty'
  | 'offDuty'
  | 'sleeper';

/** Solid colours matching the badge tones, for the map and the timeline rail. */
export const DUTY_STATUS_COLORS: Record<DutyStatus, string> = {
  driving: '#2563eb',
  on_duty_not_driving: '#d97706',
  off_duty: '#64748b',
  sleeper_berth: '#7c3aed',
};

/** Map marker colours, per the design system. */
export const MAP_COLORS = {
  current: '#2563eb',
  pickup: '#d97706',
  delivery: '#16a34a',
  deadhead: '#94a3b8',
  loaded: '#2563eb',
} as const;

export function dutyStatusTone(status: DutyStatus): BadgeTone {
  switch (status) {
    case 'driving':
      return 'driving';
    case 'on_duty_not_driving':
      return 'onDuty';
    case 'sleeper_berth':
      return 'sleeper';
    case 'off_duty':
    default:
      return 'offDuty';
  }
}

export function tripStatusTone(status: TripStatus): BadgeTone {
  switch (status) {
    case 'planned':
      return 'success';
    case 'failed':
      return 'danger';
    case 'pending':
    default:
      return 'warning';
  }
}

/** Plain-language label for a trip status, for drivers rather than developers. */
export function tripStatusLabel(status: TripStatus): string {
  switch (status) {
    case 'planned':
      return 'Planned';
    case 'failed':
      return 'Failed';
    case 'pending':
    default:
      return 'Pending';
  }
}
