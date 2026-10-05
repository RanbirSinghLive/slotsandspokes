import { geoInterpolate } from 'd3-geo';
import { greatCircleDistanceNm } from '../sim/geo';
import type { ActiveFlight } from '../sim/state';

type LonLat = [number, number];

/**
 * The path a flight flies, as a function of how far along it is (0 to 1): the
 * geodesic from origin to destination, or from origin through its detour
 * waypoint to destination when it is flying round an airspace closure
 * (sim/airspace.ts). One place builds it so the plane, its trail and its
 * heading all follow the same line.
 */
export function flightInterpolator(flight: ActiveFlight, origin: LonLat, dest: LonLat): (t: number) => LonLat {
  if (!flight.via) return geoInterpolate(origin, dest) as (t: number) => LonLat;
  const via = flight.via;
  const firstLeg = geoInterpolate(origin, via);
  const secondLeg = geoInterpolate(via, dest);
  const first = greatCircleDistanceNm({ lon: origin[0], lat: origin[1] }, { lon: via[0], lat: via[1] });
  const second = greatCircleDistanceNm({ lon: via[0], lat: via[1] }, { lon: dest[0], lat: dest[1] });
  const split = first / (first + second);
  return (t) => (t <= split ? (firstLeg(t / split) as LonLat) : (secondLeg((t - split) / (1 - split)) as LonLat));
}
