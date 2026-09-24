import { nextRandom } from './rng';
import { leaseRateFor, USEFUL_LIFE_YEARS } from './leasing';
import type { Aircraft, SimState } from './state';

/**
 * The fleet market: one lessor that every airline leases from, first come
 * first served. It's the game's main pacing gate — how fast any airline,
 * the player or a rival, can grow is how fast airframes come to market.
 *
 * Each class has its own rhythm:
 *   - a debut day, before which none exist at all (bigger classes later);
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
 */

export type MarketListing = {
  id: number;
  typeCode: string;
  ageYears: number;
  leasePricePerDay: number;
  listedDay: number;
};

export type MarketState = {
  listings: MarketListing[];
  /** Day each class's next airframe arrives, keyed by class code. */
  nextArrivalDay: Record<string, number>;
  nextListingId: number;
};

type ClassRhythm = { debutDay: number; initial: number; intervalDays: number; cap: number };

export const MARKET_RHYTHM: Record<string, ClassRhythm> = {
  PROP: { debutDay: 0, initial: 3, intervalDays: 4, cap: 3 },
  REGIONAL: { debutDay: 0, initial: 1, intervalDays: 10, cap: 2 },
  NARROWBODY: { debutDay: 20, initial: 1, intervalDays: 20, cap: 2 },
  WIDEBODY: { debutDay: 45, initial: 1, intervalDays: 35, cap: 1 },
};

/** Listed airframes are this many years old, give or take: 15 to 24. */
const MIN_LISTING_AGE = 15;
const LISTING_AGE_SPREAD = 10;
/** Returning a lease early costs this many days of it. */
export const RETURN_FEE_LEASE_DAYS = 14;
/** How many daily flights one rival airframe carries. */
const FLIGHTS_PER_RIVAL_PLANE = 3;
/** Rivals move up a class as they grow: at this many daily flights, a Narrowbody; at the next, a Widebody. */
const RIVAL_NARROWBODY_FLIGHTS = 6;
const RIVAL_WIDEBODY_FLIGHTS = 14;
/** Largest class first; a rival falls back down this list when its preferred class isn't on the market. Rivals never take Propellers. */
const RIVAL_CLASS_LADDER = ['WIDEBODY', 'NARROWBODY', 'REGIONAL'];

const MINUTES_PER_DAY = 1440;

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
    if (rhythm.debutDay === 0) for (let i = 0; i < rhythm.initial; i++) next = addListing(market, code, 0, next);
    market.nextArrivalDay[code] = rhythm.debutDay === 0 ? rhythm.intervalDays : rhythm.debutDay;
  }
  return [market, next];
}

/**
 * The daily delivery, from step.ts's rollover (after the rivals have
 * grown, so a new airframe sits listed for a full day): a class debuts with its
 * first listings on its debut day, then one airframe arrives each
 * interval — lost if the shelf is already full.
 */
export function rollDailyMarket(state: SimState, day: number): void {
  const market = state.market;
  for (const [code, rhythm] of Object.entries(MARKET_RHYTHM)) {
    if (day < market.nextArrivalDay[code]) continue;
    const debut = day === rhythm.debutDay && rhythm.debutDay > 0;
    const arrivals = debut ? rhythm.initial : 1;
    for (let i = 0; i < arrivals; i++) {
      if (listingsOf(state, code).length >= rhythm.cap) break;
      state.rngSeed = addListing(market, code, day, state.rngSeed);
    }
    market.nextArrivalDay[code] = day + rhythm.intervalDays;
  }
}

/** This class's listings, the one a lease would take first. */
export function listingsOf(state: SimState, typeCode: string): MarketListing[] {
  return state.market.listings.filter((listing) => listing.typeCode === typeCode).sort((a, b) => a.id - b.id);
}

/** Days until the next airframe of this class arrives: 1 means the next rollover's delivery. */
export function daysUntilNextListing(state: SimState, typeCode: string): number {
  const today = Math.floor(state.simMinute / MINUTES_PER_DAY);
  return Math.max(1, state.market.nextArrivalDay[typeCode] - today);
}

/** Whether this class has reached the market yet. */
export function hasDebuted(state: SimState, typeCode: string): boolean {
  return Math.floor(state.simMinute / MINUTES_PER_DAY) >= (MARKET_RHYTHM[typeCode]?.debutDay ?? 0);
}

/** Take the first listing of this class off the market, or null when there isn't one. */
export function takeListing(state: SimState, typeCode: string): MarketListing | null {
  const listing = listingsOf(state, typeCode)[0];
  if (!listing) return null;
  state.market.listings = state.market.listings.filter((l) => l !== listing);
  return listing;
}

// --- Returning a lease -----------------------------------------------------

/** Why this plane can't go back to the lessor right now, or null when it can. */
export function returnBlockedReason(state: SimState, aircraft: Aircraft): string | null {
  if (state.schedule.some((leg) => leg.tail === aircraft.tail)) return `${aircraft.tail} still has flights. Remove them first.`;
  if (state.aogs.some((event) => event.tail === aircraft.tail)) return `${aircraft.tail} is grounded with an AOG.`;
  if (aircraft.status !== 'ground') return `${aircraft.tail} is in the air.`;
  return null;
}

export function returnFee(aircraft: Aircraft): number {
  return RETURN_FEE_LEASE_DAYS * aircraft.leaseCostPerDay;
}

/** Hand a plane back to the lessor for a fee; it goes back on the market for anyone to lease. */
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
  state.aircraft = state.aircraft.filter((a) => a !== aircraft);
  state.market.listings.push({
    id: state.market.nextListingId++,
    typeCode: aircraft.typeCode,
    ageYears: aircraft.ageYears,
    leasePricePerDay: aircraft.leaseCostPerDay,
    listedDay: Math.floor(state.simMinute / MINUTES_PER_DAY),
  });
  const lifeLeft = Math.max(0, USEFUL_LIFE_YEARS - aircraft.ageYears);
  return {
    ok: true,
    message: `${tail} returned to the lessor for $${fee.toLocaleString()}. It's back on the market (${aircraft.ageYears} yrs, ${lifeLeft} left).`,
  };
}

// --- Rivals ------------------------------------------------------------------

function rivalFlights(state: SimState, code: string): number {
  return state.competitorRoutes.filter((route) => route.code === code).reduce((total, route) => total + route.dailyFrequency, 0);
}

/** The class a rival of this size wants next. */
function preferredRivalClass(flights: number): string {
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
    state.competitorFleets[code] = Array.from({ length: planes }, () => preferredRivalClass(flights));
  }
}

/**
 * Before a rival adds `extraFlights` a day (a new route, a new frequency,
 * or entering the map at all): whether its fleet can carry them, leasing
 * a plane from the shared market if not. Its preferred class first, then
 * smaller ones; false — and the growth doesn't happen today — when the
 * market has nothing it can use.
 */
export function rivalSecuresCapacity(state: SimState, code: string, extraFlights: number): boolean {
  const fleet = state.competitorFleets[code] ?? [];
  const needed = Math.ceil((rivalFlights(state, code) + extraFlights) / FLIGHTS_PER_RIVAL_PLANE);
  if (fleet.length >= needed) return true;
  const preferred = preferredRivalClass(rivalFlights(state, code) + extraFlights);
  for (const typeCode of RIVAL_CLASS_LADDER.slice(RIVAL_CLASS_LADDER.indexOf(preferred))) {
    if (takeListing(state, typeCode)) {
      // Only recorded once it has a plane: a rival whose entry fails today
      // shouldn't leave an empty fleet behind.
      state.competitorFleets[code] = [...fleet, typeCode];
      return true;
    }
  }
  return false;
}
