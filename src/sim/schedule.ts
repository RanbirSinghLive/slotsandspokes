import scheduleData from '../../data/schedule.json';
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

/**
 * A one-time repositioning move — flown once to get a tail from wherever it
 * actually is to wherever a route it's just been assigned to needs it to
 * start, then discarded. Distinct from ScheduleLeg in the way that matters:
 * `departMinute` here is an absolute `simMinute` (this specific moment in
 * this specific game), not a recurring minute-of-day, since this leg never
 * repeats. Created automatically by ui/routeBuilder.ts whenever a route is
 * assigned to a tail that isn't already standing at its origin — the point
 * is for the player to describe the network they want and have the game
 * work out how to get a plane there, not to hand-solve a routing puzzle
 * before every new route. It still costs real money (fuel and departure
 * cost, via sim/economy.ts's legCost()) and still carries weather/delay
 * risk, same as any other flight — the only thing it skips is passengers
 * and revenue, since there's no market to sell seats on.
 */
export type PositioningLeg = {
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
 * a real runway/gate constraint some airports have (Billy Bishop's YTZ,
 * LaGuardia's LGA), modeled the same crude "hard limit, full stop" way
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

// data/schedule.json's fixed template (below) predates the week-four
// aircraft ladder and was authored against a single type — every one of
// its legs still computes its block time against that first type's cruise
// speed by default, which is exactly right for it: createInitialState()
// (the headless runner's own entry point) always builds every aircraft as
// this same first type regardless, so there's no per-tail speed to look up
// for that fixed network anyway. A real game's legs pass their aircraft's
// actual cruiseKts explicitly instead — see the `cruiseKts` parameter
// below, and ui/routeBuilder.ts's call sites for where that comes from.
const DEFAULT_CRUISE_KTS = (aircraftTypesData as AircraftType[])[0].cruiseKts;

/**
 * Block time for a leg between two airports, from great-circle distance
 * and `cruiseKts` — see CLAUDE.md's note on this formula. `cruiseKts`
 * defaults to the fixed template's single type (see the note above) but
 * should be passed explicitly for any leg with a real aircraft assigned,
 * so a Q400 or A220 route isn't timed as if a 1900D were flying it.
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
const BASE_FARE = 125;
const PER_NM_RATE = 0.3;

/**
 * The game's suggested fare for a *market* (an origin-dest pair, either
 * direction), from great-circle distance alone. Fare is set at the route
 * level, not per individual leg — see `marketKey()` and
 * `SimState.routeSettings` (sim/state.ts) — so a market with two daily
 * frequencies still has exactly one fare, not two independently
 * adjustable ones. This is only ever a *default*: decision 3 in
 * WEEK-TWO.md is explicit that fare is a player-overridable lever, not a
 * fixed number — see ui/commercial.ts, week two's route-level "Commercial"
 * panel.
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
 * The bidirectional key for "the market between these two airports" — a
 * leg YHZ→YQM and a leg YQM→YHZ are the same market under this key, the
 * same definition `render/routes.ts`'s route-dedup and
 * `ui/routeBuilder.ts`'s `isExistingMarket()` already use, just centralized
 * here since `SimState.routeSettings` (sim/state.ts) now needs the same
 * concept as an actual lookup key, not just a comparison.
 */
export function marketKey(a: string, b: string): string {
  return [a, b].sort().join('-');
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
export const scheduleLegs: ScheduleLeg[] = (scheduleData as Array<Omit<ScheduleLeg, 'blockMinutes'>>).map((leg) => ({
  ...leg,
  blockMinutes: computeBlockMinutes(leg.origin, leg.dest),
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
 * Same idea as nextLegId() above, one counter per tail, but its own
 * "-POS-" namespace so a positioning leg's id can never collide with a
 * regular scheduled leg's.
 */
export function nextPositioningLegId(tail: string, positioningLegs: PositioningLeg[]): string {
  const existingNumbers = positioningLegs
    .filter((leg) => leg.tail === tail)
    .map((leg) => Number(leg.legId.split('-').pop()))
    .filter((n) => !Number.isNaN(n));
  const nextNumber = (existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0) + 1;
  return `${tail}-POS-${nextNumber}`;
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
 * Sanity-check that every aircraft's day is one unbroken chain: the
 * destination of one leg must be the origin of that same tail's next leg,
 * with at least MIN_TURN_MINUTES on the ground in between. A schedule that
 * fails this would make an aircraft "teleport" once M4 starts flying it —
 * a confusing bug to chase after the fact, so we catch it here at load
 * time instead.
 *
 * `state.schedule` is meant to be *the* daily schedule — the same rotation
 * repeating every day, not a one-off plan for a single day (see CLAUDE.md).
 * That only actually holds if each tail's day is a closed loop: the last
 * leg's destination must also be its first leg's origin, or day 2 starts
 * with the aircraft in the wrong place and that tail's first departure
 * silently never fires again — the same failure mode as a broken link
 * between two legs, just one day delayed and easy to miss because the
 * schedule looks fine for the rest of the day it was edited. Checked here
 * too, not just link-by-link.
 *
 * Also checks something the two rules above can't: whether each tail's
 * *actual current position* (`fleet`, i.e. `state.aircraft`) is anywhere in
 * its own rotation at all. A schedule can be perfectly self-consistent —
 * every leg chains into the next, the loop closes — and still never fly a
 * single leg, if the aircraft assigned to it is physically sitting
 * somewhere that schedule never visits. That happens easily once a player
 * starts editing mid-game: delete every leg that used to bring a tail
 * through some airport, and its schedule can still "validate clean" while
 * being permanently unreachable from where the plane actually is. Distinct
 * from the loop-closure check: that one only looks at the schedule's own
 * internal shape; this one looks at the schedule against the world.
 *
 * `positioningLegs` (also week three) keeps the "stranded" check above from
 * crying wolf: a tail that isn't currently standing anywhere in its own
 * rotation is only a real problem if nothing is already fixing it. The M10
 * route builder auto-creates a positioning leg the moment it assigns a
 * route to a tail that isn't at the route's origin (see
 * ui/routeBuilder.ts), so the moment right after that — aircraft still
 * physically elsewhere, positioning leg queued but not yet flown — should
 * read as "in progress," not "broken."
 *
 * Logs one line per problem found, or a single OK line, and also *returns*
 * the problem list (empty when the schedule is clean) — added in week
 * three so callers can show a warning somewhere a player will actually see
 * it. Console-only errors turned out to be invisible in practice: a route
 * added onto a tail that's already busy elsewhere breaks silently from the
 * player's point of view (no revenue, aircraft just sits there) unless
 * they happen to have devtools open at the moment they add it.
 */
/**
 * The chain/turn-time/closure checks validateSchedule() below applies to
 * every tail, scoped to a single tail's own legs — pulled out on its own so
 * the M11 rotation board's drag-to-retime preview can ask "would this
 * tail's day still chain if this one leg landed at a new time," without
 * involving every other tail or the whole-schedule stranded-aircraft check
 * (that one needs the live fleet, which isn't meaningful mid-drag, before
 * anything is actually committed).
 */
export function tailRotationProblems(tail: string, tailLegs: ScheduleLeg[]): string[] {
  const problems: string[] = [];
  const sorted = [...tailLegs].sort((a, b) => a.departMinute - b.departMinute);

  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const current = sorted[i];

    if (previous.dest !== current.origin) {
      problems.push(
        `${tail} lands at ${previous.dest} on ${previous.legId} but ${current.legId} departs from ${current.origin}`,
      );
    }

    const turnMinutes = current.departMinute - (previous.departMinute + previous.blockMinutes);
    if (turnMinutes < MIN_TURN_MINUTES) {
      problems.push(`${tail} has only ${turnMinutes} minutes on the ground between ${previous.legId} and ${current.legId}`);
    }
  }

  if (sorted.length > 0) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (last.dest !== first.origin) {
      problems.push(
        `${tail}'s rotation doesn't close -- ${last.legId} lands at ${last.dest}, but the day restarts at ${first.origin} (${first.legId}). Add a leg back to ${first.origin}, or that first departure will never fire again.`,
      );
    }
  }

  return problems;
}

export function validateSchedule(
  legs: ScheduleLeg[],
  fleet: Aircraft[] = [],
  positioningLegs: PositioningLeg[] = [],
): string[] {
  const byTail = new Map<string, ScheduleLeg[]>();
  for (const leg of legs) {
    const group = byTail.get(leg.tail) ?? [];
    group.push(leg);
    byTail.set(leg.tail, group);
  }

  const problems: string[] = [];

  for (const [tail, tailLegs] of byTail) {
    problems.push(...tailRotationProblems(tail, tailLegs));
  }

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
      const alreadyBeingFixed = positioningLegs.some((leg) => leg.tail === aircraft.tail && origins.has(leg.dest));
      if (!alreadyBeingFixed) {
        problems.push(
          `${aircraft.tail} is sitting at ${aircraft.atAirport}, but none of its scheduled legs ever depart from there -- it will never fly again until a leg (or a positioning move) gets it to one of: ${[...origins].sort().join(', ')}.`,
        );
      }
    }
  }

  if (problems.length === 0) {
    console.log(`Schedule OK: ${legs.length} legs across ${byTail.size} aircraft, no broken rotations.`);
  } else {
    for (const problem of problems) {
      console.error(`Schedule error: ${problem}`);
    }
  }

  return problems;
}
