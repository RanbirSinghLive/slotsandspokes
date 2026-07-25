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
  fare: number;
};

const TAXI_ALLOWANCE_MINUTES = 20;

/**
 * The minimum ground time between one leg and the next for the same tail.
 * Used two ways: validateSchedule() below checks the *authored* schedule
 * against it (a leg written with less gap than this is a design mistake),
 * and step.ts (M9) enforces it at runtime against the *actual* landing
 * time — an aircraft that lands late still needs at least this long before
 * its next departure, which is what lets one delay push a later one.
 */
export const MIN_TURN_MINUTES = 30;

const airportsByIata = new Map<string, AirportLocation>(
  (airportsData as AirportLocation[]).map((airport) => [airport.iata, airport]),
);

// Only one aircraft type exists so far ("more than one aircraft type" is on
// WEEK-ONE.md's deliberately-deferred list), so every leg's block time uses
// this one type's cruise speed. This will need to become a per-tail lookup
// once a second type is introduced.
const aircraftType = (aircraftTypesData as AircraftType[])[0];

/**
 * Block time for a leg between two airports, from great-circle distance and
 * the (only, for now) aircraft type's cruise speed — see CLAUDE.md's note
 * on this formula. Exported so the M10 route builder can compute a real
 * block time for a leg the player is creating, not just at schedule-load
 * time for the fixed template.
 */
export function computeBlockMinutes(originIata: string, destIata: string): number {
  const origin = airportsByIata.get(originIata);
  const dest = airportsByIata.get(destIata);
  if (!origin || !dest) {
    throw new Error(`Schedule references an unknown airport: ${originIata} -> ${destIata}`);
  }
  const distanceNm = greatCircleDistanceNm(origin, dest);
  return Math.round(TAXI_ALLOWANCE_MINUTES + (distanceNm / aircraftType.cruiseKts) * 60);
}

// Week two's "Pricing" loop — deliberately crude, same spirit as
// economy.ts's LOAD_FACTOR/AVG_FARE: a fixed component (covers boarding/
// handling regardless of distance) plus a per-nm rate, the same shape
// costPerDeparture/costPerBlockHour already has. Distance is the only
// input for now — a yield-mix-based skew (a route's business/leisure/VFR
// split affecting its recommended fare) was considered, but every market
// currently shares the identical fixed 20/50/30 split (sim/choiceModel.ts),
// so a skew term would multiply every route by the same constant and add
// nothing real; worth revisiting once yield mix actually varies by route.
const BASE_FARE = 125;
const PER_NM_RATE = 0.3;

/**
 * The game's suggested fare for a leg between two airports, from
 * great-circle distance alone. This is only ever a *default* — decision 3
 * in WEEK-TWO.md is explicit that fare is a player-overridable lever, not
 * a fixed number, so every `ScheduleLeg.fare` below starts here but can be
 * changed afterward (the M8/M10-style schedule editor, see ui/panels.ts).
 */
export function recommendedFare(originIata: string, destIata: string): number {
  const origin = airportsByIata.get(originIata);
  const dest = airportsByIata.get(destIata);
  if (!origin || !dest) {
    throw new Error(`Schedule references an unknown airport: ${originIata} -> ${destIata}`);
  }
  const distanceNm = greatCircleDistanceNm(origin, dest);
  return Math.round(BASE_FARE + PER_NM_RATE * distanceNm);
}

/**
 * The daily schedule as authored in data/schedule.json, with each leg's
 * block time computed up front from great-circle distance — see
 * CLAUDE.md's note on why blockMinutes is computed at load time and stored
 * on the entry, rather than recomputed on every simulated minute.
 *
 * This is the unedited *template* — the set of city pairs ever flown,
 * which render/routes.ts uses to draw the route network, and which never
 * changes even once a player edits departure times (M8). Each SimState gets
 * its own independent, mutable copy via loadSchedule() below; nothing
 * mutates this array directly.
 */
export const scheduleLegs: ScheduleLeg[] = (
  scheduleData as Array<Omit<ScheduleLeg, 'blockMinutes' | 'fare'>>
).map((leg) => ({
  ...leg,
  blockMinutes: computeBlockMinutes(leg.origin, leg.dest),
  fare: recommendedFare(leg.origin, leg.dest),
}));

/**
 * A fresh, independent copy of the daily schedule — a new array of new leg
 * objects, so editing one game's schedule (state.schedule) can never leak
 * into another's. Called once by createInitialState(); the schedule editor
 * (ui/panels.ts) mutates the copy it gets back from there, never this
 * module's own `scheduleLegs`.
 */
export function loadSchedule(): ScheduleLeg[] {
  return scheduleLegs.map((leg) => ({ ...leg }));
}

/**
 * A fresh legId for a new leg on `tail` — "<tail>-<n>", one past the
 * highest existing number for that tail, matching the naming already used
 * in data/schedule.json (e.g. "C-GVIA-1".."C-GVIA-4"). Used by the M10
 * route builder when a player adds a leg; never called by anything that
 * needs to be deterministic (it's a one-off UI action, not part of step()).
 */
export function nextLegId(tail: string, legs: ScheduleLeg[]): string {
  const existingNumbers = legs
    .filter((leg) => leg.tail === tail)
    .map((leg) => Number(leg.legId.split('-').pop()))
    .filter((n) => !Number.isNaN(n));
  const nextNumber = (existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0) + 1;
  return `${tail}-${nextNumber}`;
}

/**
 * How many of `legs` serve the `origin`-`dest` market, counting both
 * directions as the same market (a leg YHZ→YQM and a leg YQM→YHZ both count)
 * — the same bidirectional definition `render/routes.ts` and
 * `ui/routeBuilder.ts`'s `isExistingMarket()` use for what counts as "the
 * same route." Used by `sim/economy.ts` (via `step.ts`) to split a market's
 * total daily demand evenly across however many flights currently serve it:
 * a market with one frequency each way gives each of those two flights half
 * the market to itself; add a third flight to that market and each of the
 * three now splits it three ways instead.
 */
export function legsServingMarket(origin: string, dest: string, legs: ScheduleLeg[]): number {
  return legs.filter(
    (leg) => (leg.origin === origin && leg.dest === dest) || (leg.origin === dest && leg.dest === origin),
  ).length;
}

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
