import { dayIndex } from './clock';
import { biggestOpenRivalClass, rivalClassOpen } from './rivalLadder';
import { isReturning, startReturn } from './fleetTiming';
import { nextRandom } from './rng';
import { leaseRateFor } from './leasing';
import { computeBlockMinutes, MIN_TURN_MINUTES } from './schedule';
import type { Aircraft, SimState } from './state';

/**
 * The fleet market: one lessor that every airline leases from, first come
 * first served. It's the game's main pacing gate — how fast any airline,
 * the player or a rival, can grow is how fast airframes come to market.
 *
 * Every class is stocked from the start, each with its own rhythm:
 *   - a refill interval: one new airframe arrives every so many days;
 *   - a cap on how many can sit listed at once. An arrival that finds the
 *     shelf full is lost, not queued, so leaving planes on the market
 *     doesn't bank future ones.
 *
 * Every listing is a particular airframe with its own age, and so its own
 * price and reliability (sim/leasing.ts, sim/delays.ts): a 16-year-old
 * listing is worth racing a rival for.
 *
 * Rivals draw from the same shelf when they grow (see rivalSecuresCapacity()),
 * so leasing the last Regional before Trillium Air does is a real move.
 *
 * Every airline earns each bigger class on the ladder, not on a date: the
 * player (sim/ladder.ts's classOpen(): Regionals as a regional carrier and
 * so on) and each rival alike (sim/rivalLadder.ts).
 */

export type MarketListing = {
  id: number;
  typeCode: string;
  ageYears: number;
  leasePricePerDay: number;
  listedDay: number;
};

/** A one-shot instruction to lease the next matching listing of a class the moment it is listed (sim/standingOrders.ts). */
export type StandingOrder = { maxAgeYears: number; maxRatePerDay?: number };

export type MarketState = {
  listings: MarketListing[];
  /** At most one per class, keyed by class code; cleared once it leases. */
  orders?: Record<string, StandingOrder>;
  /** Day each class's next airframe arrives, keyed by class code. */
  nextArrivalDay: Record<string, number>;
  nextListingId: number;
};

type ClassRhythm = { initial: number; intervalDays: number; cap: number };

/** Each class's shelf: how many are listed on day 0, how often another arrives, and the most listed at once. */
export const MARKET_RHYTHM: Record<string, ClassRhythm> = {
  PROP: { initial: 3, intervalDays: 4, cap: 3 },
  REGIONAL: { initial: 1, intervalDays: 7, cap: 3 },
  NARROWBODY: { initial: 1, intervalDays: 14, cap: 3 },
  WIDEBODY: { initial: 1, intervalDays: 35, cap: 1 },
};

/**
 * A new listing is the player's alone for this many days; rivals skip it
 * until the hold ends. Lessor deliveries land at rollover, and at fast
 * speed one game day is a couple of real seconds, so without a hold a
 * listing would be gone before anyone could look at it.
 */
export const HOLD_DAYS = 3;

/** Listed airframes are this many years old, give or take: 15 to 24. */
const MIN_LISTING_AGE = 15;
const LISTING_AGE_SPREAD = 10;
/** Returning a lease early costs this many days of it. */
export const RETURN_FEE_LEASE_DAYS = 14;
/** How many daily flights one rival airframe carries. */
export const FLIGHTS_PER_RIVAL_PLANE = 3;
/**
 * Answering a sold-out, overpriced market (sim/rivalResponse.ts), a rival
 * counts the planes a flight needs by flying time, as the player does
 * (sim/rotations.ts): block time at one common speed plus the turn, against
 * the plane-minutes three flights take on an average rival route (135 min
 * each). A short hop costs less plane than a long one, so a rival can
 * match the frequency of a dense short pair; ordinary growth stays at the
 * flat count.
 */
const TYPICAL_RIVAL_FLIGHT_MINUTES = 135;
const RIVAL_PLANE_MINUTES = FLIGHTS_PER_RIVAL_PLANE * TYPICAL_RIVAL_FLIGHT_MINUTES;
const RIVAL_PLANNING_CRUISE_KTS = 280;

/** Plane time one daily flight on this market takes: block plus the turn after it. */
export function rivalFlightMinutes(origin: string, dest: string): number {
  return computeBlockMinutes(origin, dest, RIVAL_PLANNING_CRUISE_KTS) + MIN_TURN_MINUTES;
}

/** How many planes a rival's flying takes by flying time, counting one more daily flight on `extra`. */
export function rivalPlanesByFlyingTime(state: SimState, code: string, extra: { origin: string; dest: string }): number {
  let minutes = rivalFlightMinutes(extra.origin, extra.dest);
  for (const route of state.competitorRoutes) {
    if (route.code === code) minutes += route.dailyFrequency * rivalFlightMinutes(route.origin, route.dest);
  }
  return Math.ceil(minutes / RIVAL_PLANE_MINUTES);
}
/** Rivals move up a class as they grow: at this many daily flights, a Narrowbody; at the next, a Widebody. */
const RIVAL_NARROWBODY_FLIGHTS = 6;
const RIVAL_WIDEBODY_FLIGHTS = 14;
/** Largest class first; a rival falls back down this list when its preferred class isn't on the market. */
const RIVAL_CLASS_LADDER = ['WIDEBODY', 'NARROWBODY', 'REGIONAL', 'PROP'];

/**
 * Whether a rival may take this class's next listing: only once its own
 * ladder opens the class (sim/rivalLadder.ts), as the player's does, and
 * never the last Propeller. That is the class every airline starts and
 * first grows with, and rivals act before the player each day, so without
 * this they could empty the only shelf the player can grow from.
 */
function rivalMayTake(state: SimState, code: string, typeCode: string): boolean {
  if (!rivalClassOpen(state, code, typeCode)) return false;
  return typeCode !== 'PROP' || listingsOf(state, typeCode).length > 1;
}

function addListing(market: MarketState, typeCode: string, day: number, seed: number): number {
  const [roll, next] = nextRandom(seed);
  const ageYears = MIN_LISTING_AGE + Math.floor(roll * LISTING_AGE_SPREAD);
  market.listings.push({ id: market.nextListingId++, typeCode, ageYears, leasePricePerDay: leaseRateFor(typeCode, ageYears), listedDay: day });
  return next;
}

/** A fresh market with day 0's listings, and the seed after drawing their ages. */
export function createMarket(seed: number): [MarketState, number] {
  const market: MarketState = { listings: [], nextArrivalDay: {}, nextListingId: 1 };
  let next = seed;
  for (const [code, rhythm] of Object.entries(MARKET_RHYTHM)) {
    for (let i = 0; i < rhythm.initial; i++) next = addListing(market, code, 0, next);
    market.nextArrivalDay[code] = rhythm.intervalDays;
  }
  return [market, next];
}

/**
 * The daily delivery, from step.ts's rollover (after the rivals have
 * grown, so a new airframe sits listed for a full day): one airframe of a
 * class arrives each interval — lost if the shelf is already full.
 */
export function rollDailyMarket(state: SimState, day: number): void {
  const market = state.market;
  for (const [code, rhythm] of Object.entries(MARKET_RHYTHM)) {
    if (day < market.nextArrivalDay[code]) continue;
    if (listingsOf(state, code).length < rhythm.cap) state.rngSeed = addListing(market, code, day, state.rngSeed);
    market.nextArrivalDay[code] = day + rhythm.intervalDays;
  }
}

/** This class's listings, the one a lease would take first. */
export function listingsOf(state: SimState, typeCode: string): MarketListing[] {
  return state.market.listings.filter((listing) => listing.typeCode === typeCode).sort((a, b) => a.id - b.id);
}

/** Days until the next airframe of this class arrives: 1 means the next rollover's delivery. */
export function daysUntilNextListing(state: SimState, typeCode: string): number {
  const today = dayIndex(state);
  return Math.max(1, state.market.nextArrivalDay[typeCode] - today);
}

/** Days left in this listing's player-first hold: 0 once rivals may take it. */
export function holdDaysLeft(state: SimState, listing: MarketListing): number {
  return Math.max(0, listing.listedDay + HOLD_DAYS - dayIndex(state));
}

/**
 * Take a listing of this class off the market, or null when there isn't one:
 * the one named by `listingId`, else the first. A rival (`byRival`) can't
 * take one still in its hold.
 */
export function takeListing(state: SimState, typeCode: string, listingId?: number, byRival = false): MarketListing | null {
  const candidates = listingsOf(state, typeCode).filter((l) => !byRival || holdDaysLeft(state, l) === 0);
  const listing = listingId === undefined ? candidates[0] : candidates.find((l) => l.id === listingId);
  if (!listing) return null;
  state.market.listings = state.market.listings.filter((l) => l !== listing);
  return listing;
}

// --- Returning a lease -----------------------------------------------------

/** Why this plane can't go back to the lessor right now, or null when it can. */
export function returnBlockedReason(state: SimState, aircraft: Aircraft): string | null {
  if (isReturning(aircraft)) return `${aircraft.tail} already returning · gone day ${aircraft.returningOnDay}`;
  if (state.schedule.some((leg) => leg.tail === aircraft.tail)) return `${aircraft.tail} still has flights · remove them first`;
  if (state.aogs.some((event) => event.tail === aircraft.tail)) return `${aircraft.tail} AOG`;
  if (aircraft.status !== 'ground') return `${aircraft.tail} airborne`;
  return null;
}

export function returnFee(aircraft: Aircraft): number {
  return RETURN_FEE_LEASE_DAYS * aircraft.leaseCostPerDay;
}

/**
 * Hand a plane back to the lessor for a fee. It goes back over the return
 * time (sim/fleetTiming.ts), costing its lease until it's gone, then back
 * on the market for anyone to lease.
 */
export function returnLease(state: SimState, tail: string): { ok: true; message: string } | { ok: false; reason: string } {
  const aircraft = state.aircraft.find((a) => a.tail === tail);
  if (!aircraft) return { ok: false, reason: 'No such plane.' };
  const blocked = returnBlockedReason(state, aircraft);
  if (blocked) return { ok: false, reason: blocked };
  const fee = returnFee(aircraft);
  state.cash -= fee;
  state.todayCost += fee;
  state.todayCostByCategory.lease += fee;
  state.todayMargin -= fee;
  const goesOnDay = startReturn(state, aircraft);
  return {
    ok: true,
    message: `${tail} returning · fee $${fee.toLocaleString()} · gone day ${goesOnDay} · lease $${aircraft.leaseCostPerDay.toLocaleString()}/day until then`,
  };
}

// --- Rivals ------------------------------------------------------------------

export function rivalFlights(state: SimState, code: string): number {
  return state.competitorRoutes.filter((route) => route.code === code).reduce((total, route) => total + route.dailyFrequency, 0);
}

/** The class a rival of this size wants next. */
export function preferredRivalClass(flights: number): string {
  if (flights >= RIVAL_WIDEBODY_FLIGHTS) return 'WIDEBODY';
  if (flights >= RIVAL_NARROWBODY_FLIGHTS) return 'NARROWBODY';
  return 'REGIONAL';
}

/**
 * Give every rival that doesn't have one yet a fleet sized to what it
 * already flies — the incumbents' planes predate the market, so they
 * aren't taken from it. Called at state creation and before any growth.
 */
export function ensureRivalFleets(state: SimState): void {
  for (const code of new Set(state.competitorRoutes.map((route) => route.code))) {
    if (state.competitorFleets[code]) continue;
    const flights = rivalFlights(state, code);
    const planes = Math.max(1, Math.ceil(flights / FLIGHTS_PER_RIVAL_PLANE));
    // The biggest class its ladder has opened (sim/rivalLadder.ts): a
    // newcomer's first plane is a Propeller.
    const typeCode = biggestOpenRivalClass(state, code, preferredRivalClass(flights), RIVAL_CLASS_LADDER);
    state.competitorFleets[code] = Array.from({ length: planes }, () => typeCode);
  }
}

/**
 * Before a rival adds one daily flight on `origin`-`dest` (a new route, a new frequency,
 * or entering the map at all): whether its fleet can carry them, leasing
 * a plane from the shared market if not. Its preferred class first, then
 * smaller ones; false — and the growth doesn't happen today — when the
 * market has nothing it can use.
 */
export function rivalSecuresCapacity(state: SimState, code: string, origin: string, dest: string, byFlyingTime = false): boolean {
  const fleet = state.competitorFleets[code] ?? [];
  const byCount = Math.ceil((rivalFlights(state, code) + 1) / FLIGHTS_PER_RIVAL_PLANE);
  const needed = byFlyingTime ? Math.min(byCount, rivalPlanesByFlyingTime(state, code, { origin, dest })) : byCount;
  if (fleet.length >= needed) return true;
  const preferred = preferredRivalClass(rivalFlights(state, code) + 1);
  for (const typeCode of RIVAL_CLASS_LADDER.slice(RIVAL_CLASS_LADDER.indexOf(preferred))) {
    if (rivalMayTake(state, code, typeCode) && takeListing(state, typeCode, undefined, true)) {
      // Only recorded once it has a plane: a rival whose entry fails today
      // shouldn't leave an empty fleet behind.
      state.competitorFleets[code] = [...fleet, typeCode];
      return true;
    }
  }
  return false;
}
