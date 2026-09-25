import airportsData from '../../data/airports.json';
import { classByCode, AIRCRAFT_CLASSES } from './aircraftClasses';
import { marketDistanceNm } from './demand';
import type { SimState } from './state';

/**
 * Fog by reach. The world is 150 airports but a new game shows only the
 * ones you could actually fly to, and the map opens up as the airline
 * grows:
 *
 * - The **network** is every airport you have a foothold at: your home
 *   city, every airport a plane is based at, and every airport a rotation
 *   flies to or from.
 * - Your **reach** is the range of the biggest class you have leased
 *   (a Propeller's 380 nm to start).
 * - An airport becomes **known** the moment it falls within reach of a
 *   network airport, and stays known for good: dropping a route or a
 *   plane never re-closes the fog.
 *
 * So leasing a bigger class lifts the fog out to that range from your
 * whole network, and flying to a newly known airport makes it part of the
 * network, opening the ring around it in turn. That is the game's
 * escalation: with propellers you hop across a region, a Regional opens a
 * continent, a Widebody the world. Cash decides when (leasing needs 14
 * days of the lease on hand, sim/leasing.ts).
 *
 * Pure reads of `state` apart from revealReach(), which appends to
 * `knownAirports`. Deterministic; nothing random.
 */

const allIatas = (airportsData as { iata: string }[]).map((airport) => airport.iata);

/** Every airport the airline has a foothold at. */
export function networkAirports(state: SimState): Set<string> {
  const network = new Set<string>([state.homeAirport]);
  for (const aircraft of state.aircraft) {
    if (aircraft.baseAirport) network.add(aircraft.baseAirport);
  }
  for (const leg of state.schedule) {
    network.add(leg.origin);
    network.add(leg.dest);
  }
  return network;
}

/** Range of the biggest class currently leased; a propeller's if there are no planes. */
export function bestRangeNm(state: SimState): number {
  const ranges = state.aircraft.map((aircraft) => classByCode(aircraft.typeCode)?.rangeNm ?? 0);
  return Math.max(AIRCRAFT_CLASSES[0].rangeNm, ...ranges);
}

/**
 * Add every airport now within reach of the network to `knownAirports`.
 * Returns the ones that were just added. Call it after anything that can
 * widen reach: leasing a plane, adding a rotation, choosing a home, and
 * once a day as a backstop (sim/step.ts).
 */
export function revealReach(state: SimState): string[] {
  const known = new Set(state.knownAirports);
  const network = networkAirports(state);
  const range = bestRangeNm(state);
  const added: string[] = [];

  for (const iata of allIatas) {
    if (known.has(iata)) continue;
    const reachable = network.has(iata) || [...network].some((from) => marketDistanceNm(from, iata) <= range);
    if (!reachable) continue;
    known.add(iata);
    added.push(iata);
  }

  if (added.length > 0) state.knownAirports = allIatas.filter((iata) => known.has(iata));
  return added;
}
