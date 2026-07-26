/**
 * Encoded-polyline decoder (Google's algorithm).
 *
 * `RouteLeg.encoded_polyline` is what OpenRouteService's `/v2/directions`
 * endpoint returns in `routes[].geometry`: a precision-5 encoded string. The
 * backend stores it verbatim, so decoding is the frontend's job.
 *
 * Implemented here rather than pulled in as a dependency — it is ~25 lines of
 * a stable, well-specified format, and it keeps the map free of a transitive
 * package for one function.
 */

export type LatLngTuple = [number, number];

/**
 * Decode an encoded polyline into `[latitude, longitude]` pairs.
 *
 * Returns `[]` for an empty or malformed string rather than throwing: a
 * missing geometry should degrade to "no line drawn", never break the page.
 */
export function decodePolyline(encoded: string, precision = 5): LatLngTuple[] {
  if (!encoded) return [];

  const factor = 10 ** precision;
  const points: LatLngTuple[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 1;
    let shift = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63 - 1;
      if (Number.isNaN(byte)) return points;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63 - 1;
      if (Number.isNaN(byte)) return points;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat / factor, lng / factor]);
  }

  return points;
}
