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
 * Deliberately kept to three markers and two lines. A marker per timeline event
 * would clutter the map without telling a dispatcher anything the timeline does
 * not already say more clearly.
 *
 * Markers use `divIcon` rather than Leaflet's default image marker, which avoids
 * the broken-icon-path problem under bundlers and lets each stop be colour-coded.
 */
import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapIcon } from 'lucide-react';
import { decodePolyline } from '../lib/polyline';
import type { LatLngTuple } from '../lib/polyline';
import { MAP_COLORS } from '../lib/statusStyles';
import type { RouteLeg, TimelineEvent } from '../types/api';
import { EmptyState } from './ui/EmptyState';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Leg 1 is the unloaded deadhead, leg 2 the loaded haul. */
const LEG_STYLES: Record<number, L.PolylineOptions> = {
  1: { color: MAP_COLORS.deadhead, weight: 4, opacity: 0.9, dashArray: '7 7' },
  2: { color: MAP_COLORS.loaded, weight: 5, opacity: 0.95 },
};

interface Stop {
  label: string;
  role: string;
  name: string;
  color: string;
  position: LatLngTuple;
}

interface RouteMapProps {
  route: RouteLeg[];
  timeline: TimelineEvent[];
  /** Tailwind height classes; the container needs a fixed height for Leaflet. */
  heightClass?: string;
}

function markerIcon(label: string, color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<span style="
      display:flex;align-items:center;justify-content:center;
      width:30px;height:30px;border-radius:9999px;
      background:${color};color:#ffffff;
      font:600 13px/1 Inter,system-ui,sans-serif;
      border:2.5px solid #ffffff;
      box-shadow:0 1px 4px rgba(15,23,42,.35);
    ">${label}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -18],
  });
}

function popupHtml(stop: Stop): string {
  const escape = (value: string) => value.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
  return `
    <div style="min-width:150px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
        <span style="width:8px;height:8px;border-radius:9999px;background:${stop.color}"></span>
        <span style="font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#64748b">
          ${escape(stop.role)}
        </span>
      </div>
      <div style="font-weight:600;color:#0f172a">${escape(stop.name)}</div>
    </div>`;
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
    stops.push({
      label: 'A',
      role: 'Current location',
      name: origin.location_name,
      color: MAP_COLORS.current,
      position: at(origin),
    });
  }

  const pickup = timeline.find((event) => event.event_type === 'pickup');
  if (pickup) {
    stops.push({
      label: 'B',
      role: 'Pickup',
      name: pickup.location_name,
      color: MAP_COLORS.pickup,
      position: at(pickup),
    });
  }

  const dropoff = timeline.find((event) => event.event_type === 'dropoff');
  if (dropoff) {
    stops.push({
      label: 'C',
      role: 'Delivery',
      name: dropoff.location_name,
      color: MAP_COLORS.delivery,
      position: at(dropoff),
    });
  }

  return stops.filter(
    (stop) => Number.isFinite(stop.position[0]) && Number.isFinite(stop.position[1]),
  );
}

export function RouteMap({
  route,
  timeline,
  heightClass = 'h-[320px] sm:h-[420px] lg:h-[560px]',
}: RouteMapProps) {
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

    const map = L.map(containerRef.current, {
      // Page scrolling wins over zooming; ctrl/⌘ + wheel still zooms.
      scrollWheelZoom: false,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    map.setView([39.5, -98.35], 4); // Continental US, until there is a route to fit.
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
        title: `${stop.role}: ${stop.name}`,
        alt: `${stop.role}: ${stop.name}`,
      })
        .bindPopup(popupHtml(stop), { closeButton: true, maxWidth: 260 })
        .addTo(overlay);
    }

    // Fit to the drawn geometry, preferring the polyline; fall back to the
    // markers when a provider returned no geometry at all.
    const linePoints = legs.flatMap((leg) => leg.points);
    const fitPoints = linePoints.length > 0 ? linePoints : stops.map((stop) => stop.position);

    if (fitPoints.length === 1) {
      map.setView(fitPoints[0], 11);
    } else if (fitPoints.length > 1) {
      map.fitBounds(L.latLngBounds(fitPoints), { padding: [40, 40] });
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
        aria-label="Route map showing the current location, pickup and delivery"
        className={`w-full ${heightClass}`}
      />
      {!hasGeometry && stops.length > 0 && (
        <p className="absolute inset-x-0 bottom-0 z-[400] bg-white/95 px-4 py-2 text-center text-xs text-slate-600">
          No route line was returned for this trip — showing stop markers only.
        </p>
      )}
    </div>
  );
}

/** Empty state for the map panel, before a trip has been planned. */
export function RouteMapEmpty() {
  return (
    <EmptyState
      icon={<MapIcon className="h-5 w-5" />}
      title="No route available"
      description="Plan a trip to see the deadhead and loaded legs drawn on the map."
    />
  );
}

/** Legend for the map, kept alongside it so the two stay in sync. */
export function RouteMapLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
      {[
        { color: MAP_COLORS.current, label: 'A Current' },
        { color: MAP_COLORS.pickup, label: 'B Pickup' },
        { color: MAP_COLORS.delivery, label: 'C Delivery' },
      ].map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: item.color }}
          />
          {item.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="h-0 w-5 border-t-2 border-dashed"
          style={{ borderColor: MAP_COLORS.deadhead }}
        />
        Deadhead
      </span>
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="h-[3px] w-5 rounded-full"
          style={{ background: MAP_COLORS.loaded }}
        />
        Loaded
      </span>
    </div>
  );
}
