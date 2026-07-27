/**
 * Debounced location lookup for the planner's comboboxes.
 *
 * Three things this guarantees, all of which matter when a request is fired per
 * keystroke:
 *
 * 1. **Debounced** — a lookup runs 300 ms after typing stops, not per keystroke.
 * 2. **No duplicate requests** — the last query actually searched is remembered,
 *    so re-opening a box or re-rendering does not refetch the same string.
 * 3. **No stale results** — each new lookup aborts the one before it, and a
 *    late response for a superseded query is discarded even if the abort lost
 *    the race. Without this, typing "dal" then "dallas" can leave the "dal"
 *    results on screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { MIN_QUERY_LENGTH, searchLocations } from '../lib/geocoding';
import type { LocationSuggestion } from '../lib/geocoding';

const DEBOUNCE_MS = 300;

export interface UseLocationSearchResult {
  suggestions: LocationSuggestion[];
  loading: boolean;
  /** True once a search has run and returned nothing. */
  empty: boolean;
  /** Discard results, e.g. after the user picks one. */
  reset: () => void;
}

export function useLocationSearch(query: string, enabled: boolean): UseLocationSearchResult {
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const controller = useRef<AbortController | null>(null);
  const lastQuery = useRef<string | null>(null);
  /** Monotonic id; a response from anything but the newest request is dropped. */
  const requestId = useRef(0);

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    lastQuery.current = null;
    setSuggestions([]);
    setLoading(false);
    setSearched(false);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();

    if (!enabled || trimmed.length < MIN_QUERY_LENGTH) {
      controller.current?.abort();
      setSuggestions([]);
      setLoading(false);
      setSearched(false);
      return;
    }

    // Already have results for exactly this string — do not ask again.
    if (lastQuery.current === trimmed) return;

    setLoading(true);
    const timer = window.setTimeout(async () => {
      controller.current?.abort();
      const active = new AbortController();
      controller.current = active;
      const id = ++requestId.current;

      try {
        const results = await searchLocations(trimmed, { signal: active.signal });
        if (id !== requestId.current) return; // superseded
        lastQuery.current = trimmed;
        setSuggestions(results);
        setSearched(true);
        setLoading(false);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        if (id !== requestId.current) return;
        setSuggestions([]);
        setSearched(true);
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query, enabled]);

  useEffect(() => () => controller.current?.abort(), []);

  return {
    suggestions,
    loading,
    empty: searched && !loading && suggestions.length === 0,
    reset,
  };
}
