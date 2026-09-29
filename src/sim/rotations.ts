import aircraftTypesData from '../../data/aircraft-types.json';
import { classRank } from './aircraftClasses';
import { dailyMovementsAt, slotCapacityPerDay } from './airports';
import { minuteOfDayToTimeString } from './clock';
import { greatCircleDistanceNm } from './geo';
import { policyFare } from './pricing';
import { revealReach } from './reach';
import {
  computeBlockMinutes,
  isAircraftTypeAllowedAt,
  marketKey,
  networkAirports,
  nextLegId,
  type ScheduleLeg,
} from './schedule';
import { acquireNeededSlots, quoteSlots, takeQuotedSlots, type SlotQuote } from './slots';
import type { SimState } from './state';
import {
  aircraftUtilisation,
  extraTurnMinutes,
  isLongHaulRoundTrip,
  legUtilisationMinutes,
  scheduledTurnMinutes,
  USABLE_DAY_END_MINUTE,
  USABLE_DAY_MINUTES,
  USABLE_DAY_START_MINUTE,
} from './utilisation';

/**
 * Planning and adding a rotation: the rules for what a new route may be,
 * and the one function that writes it into the schedule.
 *
 * It lives in the sim rather than beside the map gesture that draws a
 * route (ui/routeBuilder.ts) because none of it needs the page, and the
 * headless runner (src/headless/newGame.ts) has to open routes by exactly
 * the same rules a player does, or balance numbers from it would describe
 * a different game. The UI keeps only what is about the page: the gesture,
 * the popover, and refreshing panels after a commit.
 */

// Only the fields planning needs, so both the renderer's Airport and a
// plain row from data/airports.json fit without conversion.
export type RotationStop = { iata: string; name: string; lat: number; lon: number };

type AircraftTypeSpec = { code: string; name: string; seats: number; rangeNm: number; cruiseKts: number };
const aircraftTypesByCode = new Map<string, AircraftTypeSpec>(
  (aircraftTypesData as AircraftTypeSpec[]).map((type) => [type.code, type]),
);

export type PackedLeg = { origin: string; dest: string; departMinute: number; blockMinutes: number };

/** Five-minute steps, the granularity nudgeing uses to dodge an exact-time collision. */
const COLLISION_NUDGE_MINUTES = 5;
/** Enough nudging to clear a couple of hours of congestion, then give up. */
const MAX_COLLISION_NUDGES = 24;

/**
 * Walk `airports` in order, giving each leg the cursor's current time and
 * then advancing the cursor by that leg's block time plus its turn. The
 * last leg closes the loop back to `airports[0]` (the base), which is what
 * makes rotation continuity automatic — an aircraft that starts and ends
 * its day at the same place can repeat that day forever, and no
 * positioning leg is ever needed to make it work.
 *
 * A zero-length hop is skipped rather than emitted, which is what lets the
 * player click the base itself as the final stop to say "close the loop
 * here" without producing a base→base leg.
 */
function packRotation(airports: RotationStop[], cruiseKts: number | undefined, startMinute: number, state: SimState): PackedLeg[] {
  const legs: PackedLeg[] = [];
  let cursor = startMinute;
  for (let i = 0; i < airports.length; i++) {
    const from = airports[i];
    const to = airports[(i + 1) % airports.length];
    if (from.iata === to.iata) continue;
    const blockMinutes = computeBlockMinutes(from.iata, to.iata, cruiseKts);
    legs.push({ origin: from.iata, dest: to.iata, departMinute: cursor, blockMinutes });
    // The turn includes this route's buffer (sim/turnBuffer.ts), so a
    // flight added to a buffered route is spaced like the ones already on it.
    cursor += blockMinutes + scheduledTurnMinutes(state, from.iata, to.iata);
  }
  return legs;
}

/**
 * When a new rotation's day starts. The usable day opens at 06:00, but a
 * tail that already flies a rotation can only start another one after it
 * finishes the first and turns — packing every rotation from 06:00 would
 * double-book the aircraft against itself, and `validateSchedule()`'s
 * continuity check would (rightly) call that broken.
 *
 * Because every rotation ends back at the base, appending after the
 * previous one always chains cleanly: the tail lands at base, turns, and
 * departs base again.
 */
function rotationStartMinute(tail: string, state: SimState): number {
  const tailLegs = state.schedule.filter((leg) => leg.tail === tail);
  if (tailLegs.length === 0) return USABLE_DAY_START_MINUTE;
  const lastLeg = tailLegs.reduce((latest, leg) =>
    leg.departMinute + leg.blockMinutes > latest.departMinute + latest.blockMinutes ? leg : latest,
  );
  const lastArrival = lastLeg.departMinute + lastLeg.blockMinutes;
  return Math.max(USABLE_DAY_START_MINUTE, lastArrival + scheduledTurnMinutes(state, lastLeg.origin, lastLeg.dest));
}

/**
 * The packed rotation, nudged later in five-minute steps until no leg
 * departs at the exact minute another tail already flies that same market
 * (findExactTimeCollision()). Auto-packing makes that collision likely
 * rather than rare — two aircraft based at the same airport, both opening
 * their day at 06:00 on the same market, would hit it every time — and
 * the player doesn't author departure times, so there is no "pick a
 * different time" for them to do. Nudging resolves it quietly instead.
 * Gives up after MAX_COLLISION_NUDGES and returns the last attempt; the
 * fit and collision checks in planRotation() then report whatever is
 * actually wrong.
 */
function packRotationAvoidingCollisions(
  airports: RotationStop[],
  cruiseKts: number | undefined,
  startMinute: number,
  state: SimState,
): PackedLeg[] {
  const schedule = state.schedule;
  let legs = packRotation(airports, cruiseKts, startMinute, state);
  for (let attempt = 0; attempt < MAX_COLLISION_NUDGES; attempt++) {
    if (!legs.some((leg) => findExactTimeCollision(leg.origin, leg.dest, leg.departMinute, schedule))) return legs;
    legs = packRotation(airports, cruiseKts, startMinute + (attempt + 1) * COLLISION_NUDGE_MINUTES, state);
  }
  return legs;
}

/**
 * How many usable minutes the aircraft based at `baseIata` still have
 * between them. Pooled per base rather than per tail because that is the
 * level the "do I need another airframe" decision lives at (WEEK-SEVEN.md,
 * decision 1). `tail` is counted into the pool even if it is currently
 * unbased, since confirming a rotation from this base is exactly what
 * assigns it here.
 */
function baseSpareMinutes(state: SimState, baseIata: string, tail: string): number {
  const pool = state.aircraft.filter(
    (aircraft) => aircraft.baseAirport === baseIata || (aircraft.tail === tail && aircraft.baseAirport === null),
  );
  // A plane grounded by an AOG (sim/aog.ts), or ferrying to another base (sim/rebase.ts), offers no time.
  const flyable = pool.filter((aircraft) => !state.aogs.some((event) => event.tail === aircraft.tail) && aircraft.rebase === undefined);
  const capacityMinutes = flyable.length * USABLE_DAY_MINUTES;
  const usedMinutes = pool.reduce((total, aircraft) => total + aircraftUtilisation(state, aircraft.tail).minutes, 0);
  return capacityMinutes - usedMinutes;
}

/**
 * Everything the popover needs to describe — and the confirm handler needs
 * to commit — the rotation currently being drawn. One function so the two
 * can never disagree: the old form re-derived its checks in the confirm
 * handler as a defensive second pass, which meant two copies of the same
 * rules to keep in step.
 *
 * `error` non-null hard-blocks Add Rotation. `blocksAddStop` is separate
 * because one failure is genuinely fixable by extending the chain: a
 * closing leg back to base that's beyond the aircraft's range can be
 * rescued by adding a nearer stop before it. Every other failure only gets
 * worse with more legs.
 */
export type RotationPlan = {
  /** The full ordered chain including the pending destination, base first. */
  airports: RotationStop[];
  base: RotationStop;
  legs: PackedLeg[];
  /** Block plus turn for the whole rotation — what it spends of an aircraft. A long-haul round trip counts as one full usable day here. */
  rotationMinutes: number;
  /** The rotation's real length on the clock, block plus turns. */
  clockMinutes: number;
  rotationShare: number;
  spareMinutesBefore: number;
  arriveBackMinute: number;
  /** New slot pairs this rotation would take, and their daily fees (sim/slots.ts). */
  slotQuotes: SlotQuote[];
  error: string | null;
  blocksAddStop: boolean;
};

export function planRotation(chain: RotationStop[], dest: RotationStop, tail: string, state: SimState): RotationPlan {
  const base = chain[0];
  const rotationAirports = [...chain, dest];
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  const type = aircraft ? aircraftTypesByCode.get(aircraft.typeCode) : undefined;

  const legs = packRotationAvoidingCollisions(
    rotationAirports,
    type?.cruiseKts,
    rotationStartMinute(tail, state),
    state,
  );
  const clockMinutes = legs.reduce(
    (total, leg) => total + legUtilisationMinutes(leg.blockMinutes, extraTurnMinutes(state, leg.origin, leg.dest)),
    0,
  );
  // A plane that does nothing else may fly one round trip that outruns the
  // usable day (sim/utilisation.ts's isLongHaulRoundTrip()): it is then
  // "one full aircraft" and the end-of-day rule below does not apply.
  const tailIsEmpty = !state.schedule.some((leg) => leg.tail === tail);
  const longHaul = tailIsEmpty && rotationAirports.length === 2 && isLongHaulRoundTrip(legs.length, clockMinutes);
  const rotationMinutes = longHaul ? USABLE_DAY_MINUTES : clockMinutes;
  const lastLeg = legs[legs.length - 1];
  const arriveBackMinute = lastLeg ? lastLeg.departMinute + lastLeg.blockMinutes : rotationStartMinute(tail, state);
  const spareMinutesBefore = baseSpareMinutes(state, base.iata, tail);

  const plan: RotationPlan = {
    airports: rotationAirports,
    base,
    legs,
    rotationMinutes,
    clockMinutes,
    rotationShare: rotationMinutes / USABLE_DAY_MINUTES,
    spareMinutesBefore,
    arriveBackMinute,
    slotQuotes: [],
    error: null,
    blocksAddStop: true,
  };

  const fail = (error: string, blocksAddStop = true): RotationPlan => ({ ...plan, error, blocksAddStop });

  // Grow the network one airport at a time: a rotation's base has to
  // already be somewhere the player flies. Only the base is checked, not
  // every stop — each later stop is reached by the leg immediately before
  // it, so the chain brings its own reachability with it. An empty network
  // (the very first rotation of the game) is exempt, since nothing could
  // possibly be "already in" it yet.
  const network = networkAirports(state.schedule);
  if (network.size > 0 && !network.has(base.iata)) {
    return fail(
      `${base.iata} isn't in your network yet — a rotation has to start from an airport you already fly to. ` +
        `Fly there as a destination first, then rotations can start from it.`,
    );
  }

  // Slots (sim/slots.ts): every departure needs a slot pair at its
  // airport. Counted across the whole chain — a rotation that passes
  // through the same airport twice needs two. What's quoted here is taken
  // automatically on confirm; the only hard stop is an airport with no
  // room left at any price.
  const departuresByAirport = new Map<string, number>();
  const arrivalsByAirport = new Map<string, number>();
  for (const leg of legs) {
    departuresByAirport.set(leg.origin, (departuresByAirport.get(leg.origin) ?? 0) + 1);
    arrivalsByAirport.set(leg.dest, (arrivalsByAirport.get(leg.dest) ?? 0) + 1);
  }
  plan.slotQuotes = quoteSlots(state, departuresByAirport, arrivalsByAirport);
  const full = plan.slotQuotes.find((quote) => quote.full);
  if (full) {
    return fail(
      `${full.iata} is full: ${dailyMovementsAt(state, full.iata)} takeoffs and landings a day already fill its busiest hours ` +
        `(room for ${slotCapacityPerDay(state, full.iata)}), so it has no slots left. Grow somewhere quieter, or carry the traffic on fewer, bigger aircraft.`,
    );
  }

  if (type) {
    // A route beyond the selected plane's real range (see the
    // ring drawn in drawRoutePreview()) is flatly impossible, not just
    // inadvisable. Every leg of the chain gets checked, including the
    // closing one back to base — which is the leg a long final stop
    // quietly breaks, and the only failure a further stop can fix.
    for (const leg of legs) {
      const distanceNm = greatCircleDistanceNm(
        airportByIata(leg.origin, rotationAirports),
        airportByIata(leg.dest, rotationAirports),
      );
      if (distanceNm <= type.rangeNm) continue;
      const isClosingLeg = leg === lastLeg && leg.dest === base.iata;
      // Both messages name the leg as `origin → dest`, the direction it is
      // actually flown: naming the base first for a leg flying toward it
      // reads as if range were measured from the base, when every leg is
      // checked on its own.
      return fail(
        isClosingLeg
          ? `This rotation can't close: ${leg.origin} → ${base.iata} is ${Math.round(distanceNm)} nm, beyond the ${type.name}'s ${type.rangeNm} nm range. Add a stop on the way back to ${base.iata}.`
          : `${leg.origin} → ${leg.dest} is ${Math.round(distanceNm)} nm — beyond the ${type.name}'s ${type.rangeNm} nm range with a full load.`,
        !isClosingLeg,
      );
    }

    // Airport size constraints (RotationStop.maxAircraftType) are
    // just as much a hard "no" as range — a real runway or gate limit,
    // not a matter of degree — so this gets the same block-and-explain
    // treatment. Checked at every airport the rotation touches.
    for (const airport of rotationAirports) {
      if (isAircraftTypeAllowedAt(airport.iata, type.code)) continue;
      return fail(`${airport.iata} only takes aircraft up to a smaller size than the ${type.name} — too large to operate there.`);
    }
  }

  // The fit check. The rotation has to
  // land back at base inside the usable day (06:00–22:00). When it doesn't,
  // the useful thing to say is whether the *base* has room even though this
  // tail doesn't — the pooled figure is what decides "another aircraft, or
  // a shorter rotation?", and a pooled check of its own would never fire
  // separately (a rotation that fits one tail's day always fits its base's
  // pool, since the pool contains that tail).
  if (!longHaul && arriveBackMinute > USABLE_DAY_END_MINUTE) {
    return fail(
      `This rotation lands back at ${base.iata} at ${minuteOfDayToTimeString(arriveBackMinute)}, past the ${minuteOfDayToTimeString(USABLE_DAY_END_MINUTE)} end of the usable day. ` +
        `Every plane based at ${base.iata} is full: lease another (tap ${base.iata}, then Plane) or shorten the rotation.`,
    );
  }

  // Anything still colliding after packRotationAvoidingCollisions() gave
  // up. Rare, and not something the player can retime any more, so it says
  // what it is rather than asking for a different time.
  const collision = legs
    .map((leg) => findExactTimeCollision(leg.origin, leg.dest, leg.departMinute, state.schedule))
    .find((leg) => leg !== undefined);
  if (collision) {
    return fail(
      `${collision.tail} already departs ${collision.origin} for ${collision.dest} at every minute this rotation could use (${collision.legId}). Thin out that market first.`,
    );
  }

  return { ...plan, error: null, blocksAddStop: false };
}

/**
 * Look an RotationStop back up from a packed leg's IATA code. Every leg is
 * built from a consecutive pair in the chain, so the chain always
 * contains both of its endpoints — this never misses.
 */
function airportByIata(iata: string, chain: RotationStop[]): RotationStop {
  return chain.find((airport) => airport.iata === iata)!;
}

/**
 * A leg already departing this exact origin, for this exact destination,
 * at this exact minute — checked same-direction only, unlike
 * isExistingMarket() in ui/routeBuilder.ts. Same-direction matters here: two flights leaving
 * in *opposite* directions at the same clock time is an ordinary
 * synchronized schedule bank, not a conflict. Two leaving the same
 * direction at the identical minute has no legitimate interpretation in
 * this model.
 */
function findExactTimeCollision(
  originIata: string,
  destIata: string,
  departMinute: number,
  schedule: ScheduleLeg[],
): ScheduleLeg | undefined {
  return schedule.find(
    (leg) => leg.origin === originIata && leg.dest === destIata && leg.departMinute === departMinute,
  );
}

/**
 * Every aircraft that could fly a rotation based at `baseIata`: already
 * based there, or not based anywhere yet (flying its first rotation is
 * what bases it). Smallest class first, then fleet order, so the cheapest
 * suitable plane is tried before a bigger one.
 */
export function candidateTailsAt(state: SimState, baseIata: string): string[] {
  return state.aircraft
    .filter((a) => (a.baseAirport === baseIata || a.baseAirport === null) && a.returningOnDay === undefined && a.rebase === undefined)
    .map((a, index) => ({ tail: a.tail, rank: classRank(a.typeCode), index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((a) => a.tail);
}

/**
 * Choose the plane for a rotation the player hasn't named one for: the
 * first candidate (smallest class first) whose plan has no error, so
 * range, airport size and day-length limits quietly steer the choice.
 * When nothing fits, returns the first candidate anyway so the form can
 * show that plane's actual error, not a vague "no plane". Null only when
 * there is no candidate at all.
 */
export function autoPickTail(state: SimState, chain: RotationStop[], dest: RotationStop | null): string | null {
  const candidates = candidateTailsAt(state, chain[0].iata);
  if (candidates.length === 0) return null;
  if (!dest) return candidates[0];
  const fitting = candidates.find((tail) => planRotation(chain, dest, tail, state).error === null);
  return fitting ?? candidates[0];
}

/**
 * Turn a plan into real schedule legs: base an unbased aircraft, place a
 * plane that has never flown, push the legs, take the slots, and give any
 * brand-new market its fare settings. Every way of adding a rotation goes
 * through here — the draw-a-route gesture, the map menu's frequency and
 * gauge actions, and the headless runner — so they all create it
 * identically. Returns the new leg ids and the markets that got their
 * first settings (in the direction the rotation flies them), which the UI
 * uses to add Commercial rows.
 */
export function applyRotation(
  state: SimState,
  tail: string,
  plan: RotationPlan,
): { legIds: string[]; newMarkets: { origin: string; dest: string }[] } {
  const aircraft = state.aircraft.find((a) => a.tail === tail);

  // An aircraft's base is explicit state, not
  // something inferred from its legs. An unbased airframe gets based
  // here by flying its first rotation from here — the closest thing the
  // game has to a "pick a home airport" step, and the only place a base
  // is set other than leasing a plane at an airport.
  if (aircraft && !aircraft.baseAirport) aircraft.baseAirport = plan.base.iata;

  // There are no positioning legs: a rotation ends where it began, so
  // a tail is always already at its base by the time it could fly
  // another one — the only tail that isn't is one taking its *first*
  // rotation, which is a plane left parked away from its base after its
  // previous rotations were removed. Placing it at the base is honest:
  // there's no revenue day being skipped and nothing to fly it in from.
  // A based tail whose legs start somewhere else is a different problem
  // and stays one — validateSchedule()'s stranded check reports it.
  if (aircraft && aircraft.status === 'ground' && !state.schedule.some((leg) => leg.tail === tail)) {
    aircraft.atAirport = plan.base.iata;
    aircraft.groundSinceMinute = state.simMinute;
  }

  const createdLegIds: string[] = [];
  // Keyed bidirectionally (marketKey) so out and back collapse to one
  // entry, but holding the leg itself so the Commercial row is created
  // in the direction the rotation actually flies rather than in
  // alphabetical order.
  const marketsTouched = new Map<string, PackedLeg>();
  for (const packed of plan.legs) {
    const leg: ScheduleLeg = {
      legId: nextLegId(tail, state.schedule),
      tail,
      origin: packed.origin,
      dest: packed.dest,
      departMinute: packed.departMinute,
      blockMinutes: packed.blockMinutes,
    };
    state.schedule.push(leg);
    createdLegIds.push(leg.legId);
    const key = marketKey(packed.origin, packed.dest);
    if (!marketsTouched.has(key)) marketsTouched.set(key, packed);
  }

  // Take the slot pairs the new legs need, at the prices the popover
  // showed; anything a quote didn't cover is taken at today's price.
  takeQuotedSlots(state, plan.slotQuotes);
  acquireNeededSlots(state);

  // The fare is set at the market level (sim/state.ts's RouteSettings),
  // not per leg — a brand-new market gets a fresh entry (the policy
  // fare); a rotation touching a market
  // that already has one reuses it unchanged, rather than resetting
  // whatever fare the player already set there. marketKey() is
  // bidirectional, so out and back share one entry.
  const newMarkets: { origin: string; dest: string }[] = [];
  for (const [key, leg] of marketsTouched) {
    if (state.routeSettings[key]) continue;
    // Priced by the airline-wide policy (sim/pricing.ts), not by bare
    // recommendedFare() — a new route should open at whatever the rest
    // of the network is charging, not silently ignore the policy and
    // need a manual correction straight after being drawn.
    state.routeSettings[key] = {
      fare: policyFare(state, leg.origin, leg.dest),
      fareIsOverridden: false,
      fareStance: null,
      turnBufferMinutes: 0,
    };
    newMarkets.push({ origin: leg.origin, dest: leg.dest });
  }

  // A rotation adds its airports to the network, which can open the fog
  // around them (sim/reach.ts).
  revealReach(state);
  return { legIds: createdLegIds, newMarkets };
}
