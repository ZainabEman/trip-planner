/**
 * Recently used locations, persisted locally.
 *
 * A dispatcher plans the same lanes repeatedly, so the second trip to a yard
 * should not require retyping its name. Stored in `localStorage` because it is
 * a per-browser convenience, not account data — there are no accounts.
 *
 * Every read is defensive: `localStorage` throws in private-mode Safari and
 * with storage disabled, and the stored value is user-writable, so it is
 * validated rather than trusted.
 */
import { useCallback, useEffect, useState } from 'react';
import type { LocationSuggestion } from '../lib/geocoding';

const STORAGE_KEY = 'ttp.recent-locations.v1';
const MAX_RECENTS = 6;

function isSuggestion(value: unknown): value is LocationSuggestion {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.label === 'string' &&
    typeof item.latitude === 'number' &&
    typeof item.longitude === 'number'
  );
}

function read(): LocationSuggestion[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSuggestion).slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

export function useRecentLocations() {
  const [recents, setRecents] = useState<LocationSuggestion[]>([]);

  // Read after mount rather than during render — keeps the first paint free of
  // storage access, and keeps the hook safe if it is ever server-rendered.
  useEffect(() => setRecents(read()), []);

  const remember = useCallback((location: LocationSuggestion) => {
    setRecents((current) => {
      const deduped = [location, ...current.filter((item) => item.label !== location.label)];
      const next = deduped.slice(0, MAX_RECENTS);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable — recents simply do not persist this session.
      }
      return next;
    });
  }, []);

  return { recents, remember };
}
