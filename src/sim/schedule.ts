import scheduleData from '../../data/schedule.json';
import aircraftTypesData from '../../data/aircraft-types.json';
import airportsData from '../../data/airports.json';
import { greatCircleDistanceNm } from './geo';

type AirportLocation = { iata: string; lat: number; lon: number };
type AircraftType = {
  code: string;
  name: string;
  seats: number;
  cruiseKts: number;
  costPerBlockHour: number;
  costPerDeparture: number;
};

export type ScheduleLeg = {
  legId: string;
  tail: string;
  origin: string;
  dest: string;
  departMinute: number;
  blockMinutes: number;
};

const TAXI_ALLOWANCE_MINUTES = 20;
const MIN_TURN_MINUTES = 30;

const airportsByIata = new Map<string, AirportLocation>(
  (airportsData as AirportLocation[]).map((airport) => [airport.iata, airport]),
);

// Only one aircraft type exists so far ("more than one aircraft type" is on
// WEEK-ONE.md's deliberately-deferred list), so every leg's block time uses
// this one type's cruise speed. This will need to become a per-tail lookup
// once a second type is introduced.
const aircraftType = (aircraftTypesData as AircraftType[])[0];

function computeBlockMinutes(originIata: string, destIata: string): number {
  const origin = airportsByIata.get(originIata);
  const dest = airportsByIata.get(destIata);
  if (!origin || !dest) {
    throw new Error(`Schedule references an unknown airport: ${originIata} -> ${destIata}`);
  }
  const distanceNm = greatCircleDistanceNm(origin, dest);
  return Math.round(TAXI_ALLOWANCE_MINUTES + (distanceNm / aircraftType.cruiseKts) * 60);
}

/**
 * The daily schedule, loaded once with each leg's block time computed up
 * front from great-circle distance — see CLAUDE.md's note on why
 * blockMinutes is computed at load time and stored on the entry, rather
 * than recomputed on every simulated minute.
 */
export const scheduleLegs: ScheduleLeg[] = (scheduleData as Array<Omit<ScheduleLeg, 'blockMinutes'>>).map(
  (leg) => ({
    ...leg,
    blockMinutes: computeBlockMinutes(leg.origin, leg.dest),
  }),
);

/**
 * Sanity-check that every aircraft's day is one unbroken chain: the
 * destination of one leg must be the origin of that same tail's next leg,
 * with at least MIN_TURN_MINUTES on the ground in between. A schedule that
 * fails this would make an aircraft "teleport" once M4 starts flying it —
 * a confusing bug to chase after the fact, so we catch it here at load
 * time instead. Logs one line per problem found, or a single OK line.
 */
export function validateSchedule(legs: ScheduleLeg[]): void {
  const byTail = new Map<string, ScheduleLeg[]>();
  for (const leg of legs) {
    const group = byTail.get(leg.tail) ?? [];
    group.push(leg);
    byTail.set(leg.tail, group);
  }

  let problemFound = false;

  for (const [tail, tailLegs] of byTail) {
    const sorted = [...tailLegs].sort((a, b) => a.departMinute - b.departMinute);
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      const current = sorted[i];

      if (previous.dest !== current.origin) {
        problemFound = true;
        console.error(
          `Schedule error: ${tail} lands at ${previous.dest} on ${previous.legId} but ${current.legId} departs from ${current.origin}`,
        );
      }

      const turnMinutes = current.departMinute - (previous.departMinute + previous.blockMinutes);
      if (turnMinutes < MIN_TURN_MINUTES) {
        problemFound = true;
        console.error(
          `Schedule error: ${tail} has only ${turnMinutes} minutes on the ground between ${previous.legId} and ${current.legId}`,
        );
      }
    }
  }

  if (!problemFound) {
    console.log(`Schedule OK: ${legs.length} legs across ${byTail.size} aircraft, no broken rotations.`);
  }
}
