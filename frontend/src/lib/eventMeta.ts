/**
 * Per-event-type presentation metadata: icon and a plain-language description.
 *
 * Centralised so the timeline, the map and any future log view describe an
 * event the same way. The `plain` text is written for a driver — the engine's
 * own `reason` string (with its BR citations) is shown separately for anyone
 * who wants the regulatory basis.
 */
import {
  BedDouble,
  ClipboardCheck,
  Coffee,
  Fuel,
  PackageCheck,
  PackageOpen,
  RotateCcw,
  Truck,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { EventType } from '../types/api';

interface EventMeta {
  icon: LucideIcon;
  plain: string;
}

const META: Record<EventType, EventMeta> = {
  pretrip_inspection: {
    icon: ClipboardCheck,
    plain: 'Walk-around inspection before driving. Your 14-hour window starts now.',
  },
  drive: { icon: Truck, plain: 'Driving time behind the wheel.' },
  pickup: { icon: PackageOpen, plain: 'Loading at the pickup. Counts as on-duty time.' },
  dropoff: { icon: PackageCheck, plain: 'Unloading at the delivery. Counts as on-duty time.' },
  fuel: { icon: Fuel, plain: 'Fuel stop. Counts as on-duty time.' },
  rest_break_30: {
    icon: Coffee,
    plain: 'Required 30-minute break. You may not drive again until it is complete.',
  },
  daily_rest_10: {
    icon: BedDouble,
    plain: '10 hours off duty. This resets your 11-hour driving limit and 14-hour window.',
  },
  cycle_restart_34: {
    icon: RotateCcw,
    plain: '34 hours off duty. This resets your 70-hour cycle back to zero.',
  },
  posttrip_inspection: {
    icon: Wrench,
    plain: 'Inspection after the last drive. Closes out the duty period.',
  },
};

const FALLBACK: EventMeta = { icon: Truck, plain: '' };

export function eventMeta(type: EventType): EventMeta {
  return META[type] ?? FALLBACK;
}

/**
 * Pull the business-rule citations out of an engine `reason` string.
 *
 * The engine writes them inline — "…exceeding the 14-hour duty window (BR-2)."
 * — so surfacing them as discrete chips means no separate API field is needed.
 */
export function extractRuleIds(reason: string): string[] {
  const matches = reason.match(/BR-\d+/g);
  return matches ? [...new Set(matches)] : [];
}
