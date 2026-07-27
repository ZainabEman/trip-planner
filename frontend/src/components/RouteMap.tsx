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
 * Three **route** markers (origin, pickup, delivery) plus one per stop the
 * *planner* inserted — breaks, 10-hour resets, 34-hour restarts and fuel stops.
 * The inserted stops are drawn smaller and in their own colours, so a multi-day
 * route reads as "the load goes A → B → C, and the rules forced these halts
 * along the way" rather than as an undifferentiated cloud of pins. Ordinary
 * inspections and the pickup/dropoff work are still left off: they happen at
 * markers already on the map.
 *
 * The inserted stops sit at the coordinates the engine assigned them, which for
 * a mid-leg split are interpolated along the straight line between the leg's
 * endpoints — the engine has the leg's distance and duration but not its
 * geometry. Their *timing* is exact; only the pin is approximate, and the popup
 * says so.
 *
 * Markers use `divIcon` rather than Leaflet's default image marker, which avoids
 * the broken-icon-path problem under bundlers and lets each stop be colour-coded.
 */
import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { decodePolyline } from '../lib/polyline';
import type { LatLngTuple } from '../lib/polyline';
import { formatTime } from '../lib/format';
import { isRemedy } from '../lib/planAnalysis';
import type { RemedyEventType } from '../lib/planAnalysis';
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
  /** Route endpoints are primary; planner-inserted halts are secondary. */
  kind?: 'route' | 'inserted';
  /** Extra popup line — the time of a stop, or a caveat about its position. */
  note?: string;
}

interface RouteMapProps {
  route: RouteLeg[];
  timeline: TimelineEvent[];
  /** Tailwind height classes; the container needs a fixed height for Leaflet. */
  heightClass?: string;
}

function markerIcon(label: string, color: string, kind: 'route' | 'inserted' = 'route'): L.DivIcon {
  // Inserted stops are deliberately smaller: there can be a dozen of them on a
  // cross-country plan, and they must not compete with the three markers that
  // say where the freight is going.
  const size = kind === 'route' ? 30 : 22;
  const font = kind === 'route' ? '600 13px' : '600 10px';

  return L.divIcon({
    className: '',
    html: `<span style="
      display:flex;align-items:center;justify-content:center;
      width:${size}px;height:${size}px;border-radius:9999px;
      background:${color};color:#ffffff;
      font:${font}/1 Inter,system-ui,sans-serif;
      border:${kind === 'route' ? '2.5px' : '2px'} solid #ffffff;
      box-shadow:0 1px 4px rgba(15,23,42,.35);
    ">${label}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 3],
  });
}

/**
 * Popup body.
 *
 * Built as an HTML string because Leaflet owns the popup's DOM — a React
 * component cannot be mounted into it without a second root. Every interpolated
 * value is escaped: `location_name` is user-entered text that reached us via the
 * geocoder, so it must never be trusted as markup.
 */
function popupHtml(stop: Stop): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const [lat, lng] = stop.position;

  return `
    <div style="min-width:180px;font-family:Inter,system-ui,sans-serif">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="width:18px;height:18px;border-radius:9999px;background:${stop.color};
                     color:#fff;font:600 10px/18px Inter,sans-serif;text-align:center">
          ${escape(stop.label)}
        </span>
        <span style="font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#64748b">
          ${escape(stop.role)}
        </span>
      </div>
      <div style="margin-top:6px;font-weight:600;font-size:13px;color:#0f172a">
        ${escape(stop.name)}
      </div>
      ${
        stop.note
          ? `<div style="margin-top:4px;font:400 11px/1.4 Inter,sans-serif;color:#475569">
               ${escape(stop.note)}
             </div>`
          : ''
      }
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid #e5e7eb;
                  font:400 11px/1.4 ui-monospace,monospace;color:#64748b">
        ${lat.toFixed(5)}, ${lng.toFixed(5)}
      </div>
    </div>`;
}

/** Marker colour and short label per inserted stop type. */
const INSERTED_STYLE: Record<RemedyEventType, { color: string; label: string; role: string }> = {
  rest_break_30: { color: MAP_COLORS.break, label: 'B', role: '30-minute break' },
  daily_rest_10: { color: MAP_COLORS.rest, label: 'R', role: '10-hour reset' },
  cycle_restart_34: { color: MAP_COLORS.restart, label: '34', role: '34-hour restart' },
  fuel: { color: MAP_COLORS.fuel, label: 'F', role: 'Fuel stop' },
};

/**
 * Markers for every stop the planner inserted.
 *
 * A stop whose location name is the engine's interpolated "En route to …" form
 * gets a caveat in its popup, because that pin is on the straight line between
 * the leg's endpoints rather than on the road.
 */
function extractInsertedStops(timeline: TimelineEvent[]): Stop[] {
  return timeline
    .filter((event) => isRemedy(event.event_type))
    .map((event) => {
      const style = INSERTED_STYLE[event.event_type as RemedyEventType];
      const interpolated = event.location_name.startsWith('En route to');
      return {
        label: style.label,
        role: style.role,
        name: event.location_name,
        color: style.color,
        position: [Number(event.latitude), Number(event.longitude)] as LatLngTuple,
        kind: 'inserted' as const,
        note: [
          `${formatTime(event.start_time)}–${formatTime(event.end_time)}`,
          interpolated ? 'Approximate position along the leg' : null,
        ]
          .filter(Boolean)
          .join(' · '),
      };
    })
    .filter((stop) => Number.isFinite(stop.position[0]) && Number.isFinite(stop.position[1]));
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
  const insertedStops = useMemo(() => extractInsertedStops(timeline), [timeline]);

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

    // Inserted stops go down first so the three route markers stay on top
    // where they overlap — the endpoints matter more than a halt beside them.
    for (const stop of [...insertedStops, ...stops]) {
      L.marker(stop.position, {
        icon: markerIcon(stop.label, stop.color, stop.kind ?? 'route'),
        title: `${stop.role}: ${stop.name}`,
        alt: `${stop.role}: ${stop.name}`,
        zIndexOffset: stop.kind === 'inserted' ? 0 : 500,
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
  }, [legs, stops, insertedStops]);

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
      illustration="route"
      title="No route available"
      description="Plan a trip to see the deadhead and loaded legs drawn on the map."
    />
  );
}

/**
 * Legend for the map, kept alongside it so the two stay in sync.
 *
 * `hasInserted` is passed rather than inferred so the legend does not advertise
 * marker types the map is not currently showing — a short single-day trip has
 * no breaks or resets on it.
 */
export function RouteMapLegend({ hasInserted = false }: { hasInserted?: boolean }) {
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
      {hasInserted &&
        [
          { color: MAP_COLORS.break, label: 'Break' },
          { color: MAP_COLORS.rest, label: '10-hr reset' },
          { color: MAP_COLORS.restart, label: '34-hr restart' },
          { color: MAP_COLORS.fuel, label: 'Fuel' },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full ring-1 ring-white"
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
