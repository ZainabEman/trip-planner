/**
 * Minimal hash-based routing.
 *
 * Seven pages, one of which takes a parameter (`/trips/:id`), still does not
 * justify a routing dependency — but they do need real URLs: a dispatcher must
 * be able to bookmark a trip, paste it to a driver, and use the back button.
 * `location.hash` gives all of that.
 *
 * Matching is exact-path first, then a single parameterised pattern. That is
 * deliberately the least machinery that covers the route table below; if a
 * second parameterised route ever appears, this is the moment to reach for a
 * real router instead of growing this.
 */
import { useCallback, useEffect, useState } from 'react';

export const ROUTES = {
  dashboard: '/',
  planner: '/plan',
  history: '/history',
  hos: '/hours-of-service',
  faq: '/faq',
  support: '/support',
} as const;

/** Static pages, plus `trip` which carries a trip id. */
export type RouteKey = keyof typeof ROUTES | 'trip';

export interface Route {
  key: RouteKey;
  /** Set only for `trip`. */
  tripId?: string;
}

const PATH_TO_KEY = Object.fromEntries(
  Object.entries(ROUTES).map(([key, path]) => [path, key as RouteKey]),
) as Record<string, RouteKey>;

/** Path builders — the single source for every in-app link target. */
export const paths = {
  ...ROUTES,
  trip: (id: string) => `/trips/${id}`,
} as const;

export function hrefFor(key: keyof typeof ROUTES): string {
  return `#${ROUTES[key]}`;
}

export function tripHref(id: string): string {
  return `#${paths.trip(id)}`;
}

function parse(hash: string): Route {
  const path = hash.replace(/^#/, '') || ROUTES.dashboard;

  const staticKey = PATH_TO_KEY[path];
  if (staticKey) return { key: staticKey };

  const trip = path.match(/^\/trips\/([^/]+)\/?$/);
  if (trip) return { key: 'trip', tripId: decodeURIComponent(trip[1]) };

  return { key: 'dashboard' };
}

export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  // Scroll to the top on navigation, so a long page does not leave the next one
  // mid-scroll. Keyed on the resolved path, not the object, to avoid re-firing.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.key, route.tripId]);

  const navigate = useCallback((path: string) => {
    window.location.hash = path;
  }, []);

  return { route, navigate };
}
