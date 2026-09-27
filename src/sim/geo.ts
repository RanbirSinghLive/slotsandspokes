export type LatLon = { lat: number; lon: number };

const EARTH_RADIUS_NM = 3440.065;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Great circle distance between two points, in nautical miles.
 *
 * "Great circle" means the shortest path between two points on a sphere —
 * the same idea as stretching a string tight between two points on a globe.
 * It is almost never a straight line on a flat map, which is exactly why
 * route arcs on the map curve instead of drawing straight lines between
 * airports (see render/routes.ts).
 *
 * This uses the haversine formula, which is the standard way to compute
 * great-circle distance without the numerical instability that a naive
 * "law of cosines" version has for very short distances.
 */
export function greatCircleDistanceNm(a: LatLon, b: LatLon): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLon = toRadians(b.lon - a.lon);

  const sinHalfLat = Math.sin(deltaLat / 2);
  const sinHalfLon = Math.sin(deltaLon / 2);

  const h = sinHalfLat * sinHalfLat + Math.cos(lat1) * Math.cos(lat2) * sinHalfLon * sinHalfLon;
  const centralAngle = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return EARTH_RADIUS_NM * centralAngle;
}

/**
 * Initial compass bearing from `a` to `b`, in degrees, where 0 = due north
 * and 90 = due east. This is the bearing *at the start* of the great-circle
 * path — on a long flight the true compass heading slowly changes over the
 * course of the trip, but for turning a plane's sprite we only ever
 * need the bearing between two nearby points a fraction of a second apart,
 * where that distinction doesn't matter.
 */
export function bearing(a: LatLon, b: LatLon): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLon = toRadians(b.lon - a.lon);

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  const theta = Math.atan2(y, x);
  return (toDegrees(theta) + 360) % 360;
}
