import type { ScheduleLeg } from './schedule';

/**
 * Flight numbers for the schedule. A leg has only an internal id, so the
 * number is worked out from the route: the same pair of airports always
 * gets the same number, even for one direction and odd for the other, the
 * way an airline pairs a flight with its return. A second departure on the
 * same route and direction that day takes the next thousand (SS 1214).
 * Nothing is stored, so old saves get numbers too.
 */

export const FLIGHT_NUMBER_PREFIX = 'SS';

function routeHash(a: string, b: string): number {
  let hash = 0;
  for (const character of `${a}-${b}`) hash = (hash * 31 + character.charCodeAt(0)) % 100003;
  return hash;
}

export function flightNumber(schedule: ScheduleLeg[], leg: ScheduleLeg): string {
  const [first, second] = leg.origin < leg.dest ? [leg.origin, leg.dest] : [leg.dest, leg.origin];
  const outbound = leg.origin === first;
  const sameRouteSameWay = schedule
    .filter((other) => other.origin === leg.origin && other.dest === leg.dest)
    .sort((x, y) => x.departMinute - y.departMinute || x.legId.localeCompare(y.legId));
  const frequency = Math.max(0, sameRouteSameWay.findIndex((other) => other.legId === leg.legId));
  const base = 100 + (routeHash(first, second) % 450) * 2 + (outbound ? 0 : 1);
  return `${FLIGHT_NUMBER_PREFIX} ${base + frequency * 1000}`;
}
