/**
 * Shared status → colour mapping.
 *
 * Kept out of Badge.tsx so that file exports only its component (React Fast
 * Refresh degrades when a module mixes components with other exports), and
 * because the map needs the solid colours without importing a badge.
 */
import type { DutyStatus, TripStatus } from '../types/api';

export type BadgeTone =
  'driving' | 'onDuty' | 'offDuty' | 'sleeper' | 'success' | 'danger' | 'neutral';

/** Solid colours matching the badge tones, for the map polyline and rail markers. */
export const DUTY_STATUS_COLORS: Record<DutyStatus, string> = {
  driving: '#0ea5e9',
  on_duty_not_driving: '#f59e0b',
  off_duty: '#64748b',
  sleeper_berth: '#8b5cf6',
};

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
      return 'neutral';
  }
}
