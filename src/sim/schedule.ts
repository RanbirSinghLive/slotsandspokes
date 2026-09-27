import aircraftTypesData from '../../data/aircraft-types.json';
import airportsData from '../../data/airports.json';
import { greatCircleDistanceNm } from './geo';
import type { Aircraft } from './state';

type AirportLocation = { iata: string; lat: number; lon: number; maxAircraftType?: string };
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

/**
 * The minimum ground time between one leg and the next for the same tail.
 * Used two ways: validateSchedule() below checks the *authored* schedule
 * against it (a leg written with less gap than this is a design mistake),
 * and step.ts (M9) enforces it at runtime against the *actual* landing
 * time — an aircraft that lands late still needs at least this long before
 * its next departure, which is what lets one delay push a later one.
 */
export const MIN_TURN_MINUTES = 30;

/**
 * How long after landing the M10 route builder assumes before a
 * newly-created return leg departs, when it auto-generates one — see
 * `defaultReturnDepartMinute()` below. Comfortably above MIN_TURN_MINUTES so
 * the auto-generated pair doesn't itself trip the turn-time check, without
 * requiring the player to think about it for the common case.
 */
const RETURN_TURN_BUFFER_MINUTES = 45;

const MINUTES_PER_DAY = 1440;

/**
 * The depart time the M10 route builder proposes, by default, for a route's
 * automatically-created return leg: land, then this route's own block time
 * again in the other direction (symmetric, since distance doesn't care
 * which way you fly it) plus a turnaround buffer. Wraps past midnight with
 * `% MINUTES_PER_DAY` — a route timed close enough to midnight to wrap is an
 * edge case the player can just retime by hand afterward, same as any other
 * leg.
 */
export function defaultReturnDepartMinute(outboundDepartMinute: number, blockMinutes: number): number {
  return (outboundDepartMinute + blockMinutes + RETURN_TURN_BUFFER_MINUTES) % MINUTES_PER_DAY;
}

const airportsByIata = new Map<string, AirportLocation>(
  (airportsData as AirportLocation[]).map((airport) => [airport.iata, airport]),
);

// Aircraft types are authored smallest-to-largest in data/aircraft-types.json
// (see CLAUDE.md's aircraft ladder) — that array's own order already *is*
// a size ranking, so airport constraints (below) don't need a separate
// numeric "size" field anywhere.
const aircraftTypeCodesBySize = (aircraftTypesData as { code: string }[]).map((type) => type.code);

/**
 * Whether `typeCode` is small enough to operate at `iata`, per that
 * airport's own `maxAircraftType` (`data/airports.json`, week four) —
 * a real runway/gate constraint some airports have (LaGuardia's
 * perimeter and gate rules), modeled the same crude "hard limit, full stop" way
 * range already is, rather than degrees of inconvenience. No constraint
 * (`maxAircraftType` absent) or an unrecognized type/airport code both
 * fail open (true) rather than block on a data gap. Used by the M10
 * route builder (hard-blocks drawing a too-large route), the M13
 * rotation board (flags a too-large drag red, same "allow, then flag"
 * treatment reassignment already gets), and `validateSchedule()` below
 * (a persistent warning for an already-assigned leg that violates it).
 */
export function isAircraftTypeAllowedAt(iata: string, typeCode: string): boolean {
  const maxType = airportsByIata.get(iata)?.maxAircraftType;
  if (!maxType) return true;

  const typeRank = aircraftTypeCodesBySize.indexOf(typeCode);
  const maxRank = aircraftTypeCodesBySize.indexOf(maxType);
  if (typeRank === -1 || maxRank === -1) return true;

  return typeRank <= maxRank;
}

// The smallest type's cruise speed, for block-time estimates that aren't
// about a particular aircraft. A real leg passes its aircraft's own
// cruiseKts (see sim/rotations.ts).
const DEFAULT_CRUISE_KTS = (aircraftTypesData as AircraftType[])[0].cruiseKts;

/**
 * Block time for a leg between two airports, from great-circle distance
 * and `cruiseKts` — see CLAUDE.md's note on this formula. `cruiseKts`
 * defaults to the fixed template's single type (see the note above) but
 * should be passed explicitly for any leg with a real aircraft assigned,
 * so a regional or narrowbody route isn't timed as if a propeller flew it.
 * Exported so the M10 route builder can compute a real block time for a
 * leg the player is creating, not just at schedule-load time for the
 * fixed template.
 */
export function computeBlockMinutes(originIata: string, destIata: string, cruiseKts: number = DEFAULT_CRUISE_KTS): number {
  const origin = airportsByIata.get(originIata);
  const dest = airportsByIata.get(destIata);
  if (!origin || !dest) {
    throw new Error(`Schedule references an unknown airport: ${originIata} -> ${destIata}`);
  }
  const distanceNm = greatCircleDistanceNm(origin, dest);
  return Math.round(TAXI_ALLOWANCE_MINUTES + (distanceNm / cruiseKts) * 60);
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
// Week six recalibration: both terms were raised 1.5x (was 125 / 0.30).
// The balance sweep (src/headless/sweep.ts) found margin peaking at ~2.5x
// the old recommended fare, meaning a player who never touched the fare
// slider was leaving well over half the achievable margin on the table —
// so "recommended" was recommending a bad price. Deliberately *not*
// moved all the way to the measured optimum: a default sitting exactly at
// the peak would make pricing pointless, since the curve is flat there
// (2.0x scored $13,217 against the peak's $13,390, a 1.3% difference).
// 1.5x leaves the optimum about 21% above the default — enough that
// tuning fare is a real gain, not so much that ignoring it is ruinous.
const BASE_FARE = 190;
const PER_NM_RATE = 0.45;
// Long-haul recalibration: real fares rise with distance more slowly than
// linearly (a 3,000 nm ticket costs about 3x a 500 nm one, not 6x), and
// the linear formula made a transatlantic fare $1,577. Past TAPER_NM each
// extra mile adds PER_NM_RATE_LONG instead, which is continuous at the
// join and leaves every fare of 500 nm or less exactly as it was.
const TAPER_NM = 500;
const PER_NM_RATE_LONG = 0.18;

/**
 * The game's suggested fare for a *market* (an origin-dest pair, either
 * direction), from great-circle distance alone. Fare is set at the route
 * level, not per individual leg — see `marketKey()` and
 * `SimState.routeSettings` (sim/state.ts) — so a market with two daily
 * frequencies still has exactly one fare, not two independently
 * adjustable ones. This is only ever a *default*: decision 3 in
 * WEEK-TWO.md is explicit that fare is a player-overridable lever, not a
 * fixed number: see sim/pricing.ts, and a route's Fare in
 * its route view (ui/inspector/route.ts).
 */
export function recommendedFare(originIata: string, destIata: string): number {
  const origin = airportsByIata.get(originIata);
  const dest = airportsByIata.get(destIata);
  if (!origin || !dest) {
    throw new Error(`Schedule references an unknown airport: ${originIata} -> ${destIata}`);
  }
  const distanceNm = greatCircleDistanceNm(origin, dest);
  const shortHaulNm = Math.min(distanceNm, TAPER_NM);
  const longHaulNm = Math.max(distanceNm - TAPER_NM, 0);
  return Math.round(BASE_FARE + PER_NM_RATE * shortHaulNm + PER_NM_RATE_LONG * longHaulNm);
}

/**
 * The bidirectional key for "the market between these two airports" — a
 * leg YHZ→YQM and a leg YQM→YHZ are the same market under this key, the
 * same definition `render/routes.ts`'s route-dedup and
 * `ui/routeBuilder.ts`'s `isExistingMarket()` already use, just centralized
 * here since `SimState.routeSettings` (sim/state.ts) now needs the same
 * concept as an actual lookup key, not just a comparison.
 */
export function marketKey(a: string, b: string): string {
  // Alphabetical order, compared directly rather than by sorting an array:
  // the map and the daily market pass call this for every airport pair.
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * A fresh legId for a new leg on `tail` — "<tail>-<n>", one past the
 * highest existing number for that tail (e.g. "C-P001-1", "C-P001-2").
 * Pure: the same schedule always gives the same id.
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
 * Every airport the player's network currently touches — every leg's
 * origin *and* destination, since a market served in only one direction
 * still means both ends are places the player operates. Used by
 * ui/routeBuilder.ts to enforce "grow one airport at a time": a new
 * route's origin must already be in this set (its destination doesn't
 * have to be — reaching a brand-new airport for the first time is exactly
 * how it joins the network). An empty result means there's no network
 * yet at all, which is what lets the very first route ever drawn start
 * from anywhere.
 */
export function networkAirports(legs: ScheduleLeg[]): Set<string> {
  const airports = new Set<string>();
  for (const leg of legs) {
    airports.add(leg.origin);
    airports.add(leg.dest);
  }
  return airports;
}

/**
 * What the *world* says is wrong with the schedule, as opposed to what the
 * budget says (that half is `utilisationProblems()` in sim/utilisation.ts;
 * ui/panels.ts's `scheduleProblems()` runs both).
 *
 * Week seven, phase C, deleted most of this. It used to check that each
 * tail's day was one unbroken chain — every leg's destination being the
 * next leg's origin, with MIN_TURN_MINUTES on the ground between, and the
 * last leg landing back where the first departed. None of those can fail
 * any more. The player no longer authors departure times or individual
 * legs; ui/routeBuilder.ts packs a whole rotation at once, from the base
 * back to the base, with turns built into the spacing. The
 * "lands at BOS but the next leg departs YQM" class of error is now
 * unreachable by construction, and a check that can never fire is worse
 * than no check — it implies a failure mode that doesn't exist.
 *
 * Two checks survive, because both are about the schedule meeting the
 * world rather than the schedule agreeing with itself:
 *
 * 1. **Too large for the airport.** Airport.maxAircraftType (week four) is
 *    a real runway/gate limit. The route builder blocks it up front, but a
 *    tail reassigned or a save from before a data change can still hold a
 *    violating leg, so it stays visible as a standing warning.
 * 2. **Stranded aircraft.** A tail physically parked somewhere none of its
 *    own legs ever departs from will simply never fly again. Reachable by
 *    a hand-edited save or data file now, since nothing in the game moves an
 *    aircraft's base.
 *
 * A pure check: returns the list of problems (empty when clean) and writes
 * nothing to the console. It runs every animation frame via the alert strip,
 * so logging here flooded the console; callers show the list somewhere a
 * player will actually see it instead (alert strip, renderScheduleWarnings()).
 */
export function validateSchedule(legs: ScheduleLeg[], fleet: Aircraft[] = []): string[] {
  const byTail = new Map<string, ScheduleLeg[]>();
  for (const leg of legs) {
    const group = byTail.get(leg.tail) ?? [];
    group.push(leg);
    byTail.set(leg.tail, group);
  }

  const problems: string[] = [];

  // Week four's airport constraints (Airport.maxAircraftType): a leg
  // already assigned to a tail whose aircraft is too large for one of
  // its two airports — same "too large, full stop" check the route
  // builder and rotation board use before a change is even made, run
  // here too so a violation stays visible as a standing warning rather
  // than only ever being a fleeting red flash during a drag.
  const typeCodeByTail = new Map(fleet.map((aircraft) => [aircraft.tail, aircraft.typeCode]));
  for (const leg of legs) {
    const typeCode = typeCodeByTail.get(leg.tail);
    if (!typeCode) continue; // tail isn't part of the active fleet yet
    for (const iata of [leg.origin, leg.dest]) {
      if (!isAircraftTypeAllowedAt(iata, typeCode)) {
        problems.push(`${leg.tail} (${typeCode}) is too large for ${iata} on ${leg.legId} (${leg.origin} → ${leg.dest}).`);
      }
    }
  }

  for (const aircraft of fleet) {
    const tailLegs = byTail.get(aircraft.tail);
    if (!tailLegs || tailLegs.length === 0) continue; // no schedule for this tail — nothing to be stranded from
    if (aircraft.status !== 'ground' || aircraft.atAirport === null) continue; // mid-flight right now, not stuck

    const origins = new Set(tailLegs.map((leg) => leg.origin));
    if (!origins.has(aircraft.atAirport)) {
      problems.push(
        `${aircraft.tail} is sitting at ${aircraft.atAirport}, but none of its rotations ever depart from there -- it will never fly again. ` +
          `Its rotations depart from ${[...origins].sort().join(', ')}. Remove them and draw new ones from ${aircraft.atAirport}.`,
      );
    }
  }

  return problems;
}
