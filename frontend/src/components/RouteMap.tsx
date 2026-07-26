/**
 * Leaflet map over OpenStreetMap tiles.
 *
 * Uses the Leaflet API directly rather than a React wrapper: Leaflet owns its
 * own DOM subtree, so letting React reconcile it buys nothing and adds a
 * version-compatibility surface for no gain.
 *
 * Two data sources, because neither alone is sufficient:
 *  - the **polyline** is decoded from `RouteLeg.encoded_polyline` (the stored
 *    route geometry);
 *  - the **markers** come from timeline events, because `RouteLeg` has no
 *    latitude/longitude columns — the geocoded points reach the client only as
 *    the coordinates attached to each timeline event.
 *
 * Markers use `divIcon` rather than Leaflet's default image marker, which
 * avoids the well-known broken-icon-path problem under bundlers and lets each
 * stop be colour-coded and numbered.
 */
import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { decodePolyline } from '../lib/polyline';
import type { LatLngTuple } from '../lib/polyline';
import type { RouteLeg, TimelineEvent } from '../types/api';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Leg 1 is the unloaded deadhead, leg 2 the loaded haul — drawn differently. */
const LEG_STYLES: Record<number, L.PolylineOptions> = {
  1: { color: '#64748b', weight: 4, opacity: 0.85, dashArray: '8 8' },
  2: { color: '#0ea5e9', weight: 5, opacity: 0.9 },
};

interface Stop {
  label: string;
  name: string;
  color: string;
  position: LatLngTuple;
}

interface RouteMapProps {
  route: RouteLeg[];
  timeline: TimelineEvent[];
  /** Tailwind height class; the container must have a fixed height for Leaflet. */
  heightClass?: string;
}

function markerIcon(label: string, color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<span style="
      display:flex;align-items:center;justify-content:center;
      width:28px;height:28px;border-radius:9999px;
      background:${color};color:#020617;
      font:700 12px/1 Inter,sans-serif;
      border:2px solid rgba(255,255,255,.9);
      box-shadow:0 2px 8px rgba(0,0,0,.5);
    ">${label}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
}

/**
 * Pick out the three stops the map marks.
 *
 * The first event is always the trip's opening event at the current location
 * (a pre-trip inspection, or the cycle restart when one is required), so its
 * coordinates are the origin.
 */
function extractStops(timeline: TimelineEvent[]): Stop[] {
  const at = (event: TimelineEvent): LatLngTuple => [
    Number(event.latitude),
    Number(event.longitude),
  ];
  const stops: Stop[] = [];

  const origin = timeline[0];
  if (origin) {
    stops.push({ label: 'A', name: origin.location_name, color: '#e2e8f0', position: at(origin) });
  }

  const pickup = timeline.find((event) => event.event_type === 'pickup');
  if (pickup) {
    stops.push({ label: 'B', name: pickup.location_name, color: '#f59e0b', position: at(pickup) });
  }

  const dropoff = timeline.find((event) => event.event_type === 'dropoff');
  if (dropoff) {
    stops.push({
      label: 'C',
      name: dropoff.location_name,
      color: '#34d399',
      position: at(dropoff),
    });
  }

  return stops.filter(
    (stop) => Number.isFinite(stop.position[0]) && Number.isFinite(stop.position[1]),
  );
}

export function RouteMap({ route, timeline, heightClass = 'h-[420px]' }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);

  const legs = useMemo(
    () =>
      [...route]
        .sort((a, b) => a.sequence - b.sequence)
        .map((leg) => ({ sequence: leg.sequence, points: decodePolyline(leg.encoded_polyline) })),
    [route],
  );
  const stops = useMemo(() => extractStops(timeline), [timeline]);

  // Create the map once, and tear it down on unmount so a re-mount (React
  // StrictMode double-invokes effects in development) cannot leave Leaflet
  // bound to a detached container.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { scrollWheelZoom: false, zoomControl: true });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    map.setView([39.5, -98.35], 4); // Continental US, until we have a route to fit.
    overlayRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  // Redraw the route and stops whenever either changes.
  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    if (!map || !overlay) return;

    overlay.clearLayers();

    for (const leg of legs) {
      if (leg.points.length < 2) continue;
      L.polyline(leg.points, LEG_STYLES[leg.sequence] ?? LEG_STYLES[2]).addTo(overlay);
    }

    for (const stop of stops) {
      L.marker(stop.position, {
        icon: markerIcon(stop.label, stop.color),
        title: stop.name,
        keyboard: false,
      })
        .bindPopup(`<strong>${stop.label}</strong> &middot; ${stop.name}`)
        .addTo(overlay);
    }

    // Fit to the drawn geometry, preferring the polyline; fall back to the
    // markers when a provider returned no geometry at all.
    const linePoints = legs.flatMap((leg) => leg.points);
    const fitPoints = linePoints.length > 0 ? linePoints : stops.map((stop) => stop.position);

    if (fitPoints.length === 1) {
      map.setView(fitPoints[0], 11);
    } else if (fitPoints.length > 1) {
      map.fitBounds(L.latLngBounds(fitPoints), { padding: [36, 36] });
    }

    // Leaflet mis-measures a container that was hidden or resized while the
    // plan was loading; nudge it after layout settles.
    const timer = window.setTimeout(() => map.invalidateSize(), 0);
    return () => window.clearTimeout(timer);
  }, [legs, stops]);

  const hasGeometry = legs.some((leg) => leg.points.length >= 2);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        role="application"
        aria-label="Route map"
        className={`w-full ${heightClass} bg-slate-950`}
      />
      {!hasGeometry && (
        <p className="absolute inset-x-0 bottom-0 bg-slate-950/80 px-4 py-2 text-center text-xs text-slate-400">
          No route geometry was returned for this trip — showing stop markers only.
        </p>
      )}
    </div>
  );
}

/** Legend for the map, kept alongside it so the two stay in sync. */
export function RouteMapLegend() {
  const items = [
    { swatch: '#e2e8f0', label: 'A — Current' },
    { swatch: '#f59e0b', label: 'B — Pickup' },
    { swatch: '#34d399', label: 'C — Dropoff' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-400">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: item.swatch }}
          />
          {item.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-0.5 w-5 border-t-2 border-dashed border-slate-500" />
        Deadhead
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-0.5 w-5 bg-sky-500" />
        Loaded
      </span>
    </div>
  );
}
