/**
 * Location suggestions for the planner's inputs.
 *
 * Two sources, chosen at runtime:
 *
 * 1. **OpenRouteService autocomplete** — used when `VITE_ORS_API_KEY` is set.
 *    Matches the routing provider the backend uses, so a picked suggestion is
 *    one the router will certainly resolve.
 *
 * 2. **A bundled list of US cities** — the default. No key, no network, instant.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SECURITY NOTE — read before setting `VITE_ORS_API_KEY`.
 *
 * Vite inlines `VITE_*` variables into the client bundle at build time. Setting
 * that key ships it to every browser that loads the app, where anyone can read
 * it from the network tab and spend your quota. It is acceptable for a local
 * demo and nothing else.
 *
 * The production-correct fix is a thin backend proxy — one read-only view that
 * forwards the query to ORS using the server-side key. That is a new endpoint,
 * which is outside this phase's frontend-only scope, so it is deliberately not
 * added here. Without the key the app falls back to the bundled list, which
 * covers the planner's needs without exposing anything.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface LocationSuggestion {
  /** Stable key for React lists. */
  id: string;
  /** What the user sees and what is submitted, e.g. "Dallas, TX". */
  label: string;
  city: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
  source: 'local' | 'ors';
}

const ORS_KEY: string | undefined = import.meta.env.VITE_ORS_API_KEY as string | undefined;
const ORS_BASE = 'https://api.openrouteservice.org';

export const REMOTE_ENABLED = Boolean(ORS_KEY);

/** Remote lookups only start once the query is worth a request. */
export const MIN_QUERY_LENGTH = REMOTE_ENABLED ? 3 : 1;

/**
 * Bundled US cities, `[city, state, lat, lng]`.
 *
 * Chosen for freight relevance — major metros, port cities and interstate
 * junctions — rather than population alone. Each is a place the geocoder
 * resolves cleanly, which is the practical point: typing a bare state name is
 * what produces the "no drivable route" failure the backend reports.
 */
const US_CITIES: [string, string, number, number][] = [
  ['Albuquerque', 'NM', 35.0844, -106.6504],
  ['Amarillo', 'TX', 35.222, -101.8313],
  ['Atlanta', 'GA', 33.749, -84.388],
  ['Austin', 'TX', 30.2672, -97.7431],
  ['Bakersfield', 'CA', 35.3733, -119.0187],
  ['Baltimore', 'MD', 39.2904, -76.6122],
  ['Baton Rouge', 'LA', 30.4515, -91.1871],
  ['Billings', 'MT', 45.7833, -108.5007],
  ['Birmingham', 'AL', 33.5186, -86.8104],
  ['Boise', 'ID', 43.615, -116.2023],
  ['Boston', 'MA', 42.3601, -71.0589],
  ['Buffalo', 'NY', 42.8864, -78.8784],
  ['Charleston', 'SC', 32.7765, -79.9311],
  ['Charlotte', 'NC', 35.2271, -80.8431],
  ['Chattanooga', 'TN', 35.0456, -85.3097],
  ['Cheyenne', 'WY', 41.14, -104.8202],
  ['Chicago', 'IL', 41.8781, -87.6298],
  ['Cincinnati', 'OH', 39.1031, -84.512],
  ['Cleveland', 'OH', 41.4993, -81.6944],
  ['Colorado Springs', 'CO', 38.8339, -104.8214],
  ['Columbia', 'SC', 34.0007, -81.0348],
  ['Columbus', 'OH', 39.9612, -82.9988],
  ['Dallas', 'TX', 32.7767, -96.797],
  ['Davenport', 'IA', 41.5236, -90.5776],
  ['Dayton', 'OH', 39.7589, -84.1916],
  ['Denver', 'CO', 39.7392, -104.9903],
  ['Des Moines', 'IA', 41.5868, -93.625],
  ['Detroit', 'MI', 42.3314, -83.0458],
  ['El Paso', 'TX', 31.7619, -106.485],
  ['Erie', 'PA', 42.1292, -80.0851],
  ['Eugene', 'OR', 44.0521, -123.0868],
  ['Evansville', 'IN', 37.9716, -87.5711],
  ['Fargo', 'ND', 46.8772, -96.7898],
  ['Flagstaff', 'AZ', 35.1983, -111.6513],
  ['Fort Worth', 'TX', 32.7555, -97.3308],
  ['Fresno', 'CA', 36.7378, -119.7871],
  ['Grand Rapids', 'MI', 42.9634, -85.6681],
  ['Greensboro', 'NC', 36.0726, -79.792],
  ['Harrisburg', 'PA', 40.2732, -76.8867],
  ['Hartford', 'CT', 41.7658, -72.6734],
  ['Houston', 'TX', 29.7604, -95.3698],
  ['Huntsville', 'AL', 34.7304, -86.5861],
  ['Indianapolis', 'IN', 39.7684, -86.1581],
  ['Jackson', 'MS', 32.2988, -90.1848],
  ['Jacksonville', 'FL', 30.3322, -81.6557],
  ['Kansas City', 'MO', 39.0997, -94.5786],
  ['Knoxville', 'TN', 35.9606, -83.9207],
  ['Laredo', 'TX', 27.5306, -99.4803],
  ['Las Vegas', 'NV', 36.1699, -115.1398],
  ['Lexington', 'KY', 38.0406, -84.5037],
  ['Little Rock', 'AR', 34.7465, -92.2896],
  ['Los Angeles', 'CA', 34.0522, -118.2437],
  ['Louisville', 'KY', 38.2527, -85.7585],
  ['Lubbock', 'TX', 33.5779, -101.8552],
  ['Madison', 'WI', 43.0731, -89.4012],
  ['Memphis', 'TN', 35.1495, -90.049],
  ['Miami', 'FL', 25.7617, -80.1918],
  ['Milwaukee', 'WI', 43.0389, -87.9065],
  ['Minneapolis', 'MN', 44.9778, -93.265],
  ['Mobile', 'AL', 30.6954, -88.0399],
  ['Nashville', 'TN', 36.1627, -86.7816],
  ['New Orleans', 'LA', 29.9511, -90.0715],
  ['New York', 'NY', 40.7128, -74.006],
  ['Newark', 'NJ', 40.7357, -74.1724],
  ['Norfolk', 'VA', 36.8508, -76.2859],
  ['Oakland', 'CA', 37.8044, -122.2712],
  ['Oklahoma City', 'OK', 35.4676, -97.5164],
  ['Omaha', 'NE', 41.2565, -95.9345],
  ['Orlando', 'FL', 28.5383, -81.3792],
  ['Philadelphia', 'PA', 39.9526, -75.1652],
  ['Phoenix', 'AZ', 33.4484, -112.074],
  ['Pittsburgh', 'PA', 40.4406, -79.9959],
  ['Portland', 'OR', 45.5152, -122.6784],
  ['Providence', 'RI', 41.824, -71.4128],
  ['Raleigh', 'NC', 35.7796, -78.6382],
  ['Reno', 'NV', 39.5296, -119.8138],
  ['Richmond', 'VA', 37.5407, -77.436],
  ['Roanoke', 'VA', 37.271, -79.9414],
  ['Rochester', 'NY', 43.1566, -77.6088],
  ['Sacramento', 'CA', 38.5816, -121.4944],
  ['Salt Lake City', 'UT', 40.7608, -111.891],
  ['San Antonio', 'TX', 29.4241, -98.4936],
  ['San Bernardino', 'CA', 34.1083, -117.2898],
  ['San Diego', 'CA', 32.7157, -117.1611],
  ['San Francisco', 'CA', 37.7749, -122.4194],
  ['Savannah', 'GA', 32.0809, -81.0912],
  ['Seattle', 'WA', 47.6062, -122.3321],
  ['Shreveport', 'LA', 32.5252, -93.7502],
  ['Sioux Falls', 'SD', 43.5446, -96.7311],
  ['Spokane', 'WA', 47.6588, -117.426],
  ['Springfield', 'MO', 37.2089, -93.2923],
  ['St. Louis', 'MO', 38.627, -90.1994],
  ['Stockton', 'CA', 37.9577, -121.2908],
  ['Syracuse', 'NY', 43.0481, -76.1474],
  ['Tacoma', 'WA', 47.2529, -122.4443],
  ['Tampa', 'FL', 27.9506, -82.4572],
  ['Toledo', 'OH', 41.6528, -83.5379],
  ['Tucson', 'AZ', 32.2226, -110.9747],
  ['Tulsa', 'OK', 36.154, -95.9928],
  ['Waco', 'TX', 31.5493, -97.1467],
  ['Wichita', 'KS', 37.6872, -97.3301],
  ['Wilmington', 'NC', 34.2257, -77.9447],
  ['Winston-Salem', 'NC', 36.0999, -80.2442],
  ['Youngstown', 'OH', 41.0998, -80.6495],
];

const LOCAL: LocationSuggestion[] = US_CITIES.map(([city, region, lat, lng]) => ({
  id: `local:${city},${region}`,
  label: `${city}, ${region}`,
  city,
  region,
  country: 'USA',
  latitude: lat,
  longitude: lng,
  source: 'local',
}));

/**
 * Rank local matches so the most useful appear first.
 *
 * A city whose name *starts* with the query beats one that merely contains it:
 * typing "or" should surface Orlando before Norfolk.
 */
function searchLocal(query: string, limit: number): LocationSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored = LOCAL.map((item) => {
    const city = item.city.toLowerCase();
    const label = item.label.toLowerCase();
    let score = -1;
    if (city.startsWith(q)) score = 0;
    else if (label.startsWith(q)) score = 1;
    else if (city.includes(q)) score = 2;
    else if (label.includes(q)) score = 3;
    return { item, score };
  }).filter((entry) => entry.score >= 0);

  scored.sort((a, b) => a.score - b.score || a.item.city.localeCompare(b.item.city));
  return scored.slice(0, limit).map((entry) => entry.item);
}

interface OrsFeature {
  properties?: {
    id?: string;
    label?: string;
    locality?: string;
    localadmin?: string;
    region_a?: string;
    region?: string;
    country_a?: string;
    country?: string;
    layer?: string;
  };
  geometry?: { coordinates?: [number, number] };
}

function fromOrsFeature(feature: OrsFeature, index: number): LocationSuggestion | null {
  const props = feature.properties ?? {};
  const coords = feature.geometry?.coordinates;
  if (!coords) return null;
  const [lng, lat] = coords;

  const city = props.locality ?? props.localadmin ?? props.label ?? 'Unknown';
  const region = props.region_a ?? props.region ?? '';
  const country = props.country_a ?? props.country ?? '';

  return {
    id: props.id ?? `ors:${index}:${lat},${lng}`,
    label: props.label ?? [city, region, country].filter(Boolean).join(', '),
    city,
    region,
    country,
    latitude: lat,
    longitude: lng,
    source: 'ors',
  };
}

/**
 * Look up suggestions for a query.
 *
 * `signal` lets the caller abort a request that a newer keystroke has already
 * superseded — see `useLocationSearch`. A remote failure degrades to the local
 * list rather than showing an error: the user is mid-typing, and a red banner
 * over a search box is worse than a shorter list.
 */
export async function searchLocations(
  query: string,
  { signal, limit = 8 }: { signal?: AbortSignal; limit?: number } = {},
): Promise<LocationSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  if (!REMOTE_ENABLED) return searchLocal(trimmed, limit);

  const params = new URLSearchParams({
    api_key: ORS_KEY as string,
    text: trimmed,
    size: String(limit),
    'boundary.country': 'US',
  });

  try {
    const response = await fetch(`${ORS_BASE}/geocode/autocomplete?${params}`, { signal });
    if (!response.ok) return searchLocal(trimmed, limit);
    const body: { features?: OrsFeature[] } = await response.json();
    const results = (body.features ?? [])
      .map(fromOrsFeature)
      .filter((item): item is LocationSuggestion => item !== null);
    return results.length > 0 ? results : searchLocal(trimmed, limit);
  } catch (cause) {
    // An abort is expected control flow, not a failure — rethrow so the caller
    // can ignore it rather than rendering a stale local fallback.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    return searchLocal(trimmed, limit);
  }
}
