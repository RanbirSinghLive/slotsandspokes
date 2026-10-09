import { allAirports, dailyDeparturesAt, dailyMovementsAt } from './airports';
import type { SimState } from './state';
import { airportHours, freeInDay, hourOf, hourPriceMultiplier } from './hours';

/**
 * Slots at every airport. A slot pair is the right to one daily departure
 * (and the arrival that pairs with it) at an airport, so an airline needs
 * as many pairs at an airport as it has daily departures from it.
 *
 * The price is what makes it interesting, and it's set by how contested
 * the airport is:
 *
 *   - Nobody serves it at all → the first pair is free. Opening up a new
 *     airport is encouraged, not taxed.
 *   - Otherwise the daily fee scales with the airport's traffic (every
 *     airline's takeoffs and landings, sim/airports.ts's
 *     dailyMovementsAt()) against the average airport that has any
 *     service, to the power SLOT_PRICE_EXPONENT. A field twice as busy as
 *     average costs nearly three times as much; four times as busy, eight.
 *
 * The player's own flights count toward that traffic. Building a hub makes
 * the next slot there more expensive — the price side of the same trade
 * congestion delays are the on-time side of.
 *
 * The fee is locked at the price when the slot is taken, like a lease, so
 * moving into an airport early is worth something. Slots are taken
 * automatically when a rotation needs them (the route builder shows the
 * price first) and released at the day's rollover once nothing uses them,
 * most expensive first: use it or lose it.
 *
 * Room is judged hour by hour (sim/hours.ts), for the player and every
 * rival alike. A new flight of the player's needs room in the hours its
 * legs use (the route planner looks for them, sim/rotations.ts); a rival
 * takes the peak first and spills into the rest of the day, so an airport
 * has no slots to give only when every hour is full. A slot in a busier
 * hour costs more (hourPriceMultiplier()): the peak is worth paying for,
 * not free.
 *
 * Tenure: a pair held HERITAGE_DAYS in a row is heritage. It pays
 * HERITAGE_DISCOUNT less, and the share of an airport's movements flown
 * on heritage pairs makes a rival's slots there dearer (rivalSlotQuote()).
 * It can't be bought: giving a pair back, which happens the day nothing
 * uses it, starts the clock again. A hub held for months is a moat that
 * a quiet spell dissolves.
 */

/**
 * Daily fee for a slot pair at an airport exactly as busy as the average
 * served airport. Measured: at $75 a 32-departure Halifax hub paid about
 * $8,900/day in slots, roughly 40% of its early revenue, before the
 * connectivity bonus that's meant to pay for hubs even exists. At $50 the
 * same hub pays about $5,900 and the next pair there still costs over
 * $450/day: expensive, but not a wall.
 */
const SLOT_BASE_FEE_PER_DAY = 50;
const SLOT_PRICE_EXPONENT = 1.5;
/** A slot pair adds a takeoff and a landing. */
const MOVEMENTS_PER_PAIR = 2;
/** Days a pair must be held, unbroken, to count as heritage. */
export const HERITAGE_DAYS = 180;
/** Share off the daily fee of a heritage pair. */
const HERITAGE_DISCOUNT = 0;
/** A rival's slot fee rises by this times the heritage share of an airport's movements, up to the cap. */
const HERITAGE_RIVAL_SURCHARGE = 1;
const HERITAGE_RIVAL_SURCHARGE_CAP = 0.5;

/**
 * Average daily movements across every airport some airline serves; 0 when
 * nobody flies anywhere. The same count as dailyMovementsAt(), tallied for
 * every airport in one pass over the schedule and rival routes: it's asked
 * for on every slot quote, including every rival's, and asking
 * dailyMovementsAt() airport by airport walked both lists once per airport.
 */
function averageServedMovements(state: SimState): number {
  const movements = new Map<string, number>();
  const add = (iata: string, count: number) => movements.set(iata, (movements.get(iata) ?? 0) + count);
  for (const leg of state.schedule) {
    add(leg.origin, 1);
    add(leg.dest, 1);
  }
  for (const route of state.competitorRoutes) {
    if (route.dailyFrequency === 0) continue;
    add(route.origin, 2 * route.dailyFrequency);
    if (route.dest !== route.origin) add(route.dest, 2 * route.dailyFrequency);
  }
  const served = [...movements.values()].filter((count) => count > 0);
  return served.length > 0 ? served.reduce((total, n) => total + n, 0) / served.length : 0;
}

/** Slot pairs the airline holds at this airport. */
export function slotsHeld(state: SimState, iata: string): number {
  return state.slotsHeld[iata]?.length ?? 0;
}

/** Slot pairs the current schedule needs here: one per daily departure. */
export function slotsNeeded(state: SimState, iata: string): number {
  return dailyDeparturesAt(state, iata);
}

/** Whether the pair at this index of the airport's held list has been held long enough to be heritage. */
function isHeritage(state: SimState, iata: string, index: number): boolean {
  return (state.slotDaysHeld?.[iata]?.[index] ?? 0) >= HERITAGE_DAYS;
}

/** Slot pairs here held HERITAGE_DAYS or more. */
export function heritagePairs(state: SimState, iata: string): number {
  return (state.slotsHeld[iata] ?? []).filter((_, index) => isHeritage(state, iata, index)).length;
}

/** What the airline pays per day for every slot it holds here, heritage pairs at their discount. */
export function slotFeesPerDayAt(state: SimState, iata: string): number {
  return (state.slotsHeld[iata] ?? []).reduce(
    (total, fee, index) => total + (isHeritage(state, iata, index) ? fee * (1 - HERITAGE_DISCOUNT) : fee),
    0,
  );
}

/** The share of this airport's movements, every airline's, flown on the player's heritage pairs. */
function heritageShare(state: SimState, iata: string): number {
  const movements = dailyMovementsAt(state, iata);
  return movements > 0 ? Math.min(1, (heritagePairs(state, iata) * MOVEMENTS_PER_PAIR) / movements) : 0;
}

/**
 * Daily fees for the next `count` slot pairs here, in the order they'd be
 * taken — each one adds traffic, so each costs a little more than the
 * last. `extraMovements` is traffic not on the schedule yet (a rotation
 * being previewed), counted as if it were. Null for any pair beyond the
 * airport's capacity. `average` is averageServedMovements(), passed in by a
 * caller pricing several airports against the same traffic.
 */
export function nextSlotFees(
  state: SimState,
  iata: string,
  count: number,
  extraMovements = 0,
  average: number = averageServedMovements(state),
  hourMultiplier = 1,
): (number | null)[] {
  const free = freeInDay(airportHours(state, iata)) - Math.max(0, extraMovements);
  const fees: (number | null)[] = [];
  for (let i = 0; i < count; i++) {
    const movements = dailyMovementsAt(state, iata) + extraMovements + i * MOVEMENTS_PER_PAIR;
    if (free - i * MOVEMENTS_PER_PAIR < MOVEMENTS_PER_PAIR) {
      fees.push(null);
    } else if (movements <= 0) {
      // None left once this pair is set aside: the first pair is free.
      fees.push(0);
    } else {
      const relative = movements / Math.max(average, 1);
      fees.push(Math.round((SLOT_BASE_FEE_PER_DAY * Math.pow(relative, SLOT_PRICE_EXPONENT) * hourMultiplier) / 5) * 5);
    }
  }
  return fees;
}

/**
 * What one more daily round trip costs a rival in slots, per day: a pair
 * at each end at today's price. Null if either airport is full. Rivals
 * pay for slots like the player, at the price when they take them
 * (`CompetitorOffering.slotFeesPerDay`), so an airline that moved into a
 * hub early holds its slots cheaper than one arriving once the hub is
 * busy, and a full airport takes no newcomers: the slot-control moat
 * (WEEK-NINE.md, thread 3). Seed routes hold theirs from before the game
 * and pay nothing.
 */
export function rivalSlotQuote(state: SimState, a: string, b: string): number | null {
  // Both ends priced against the same average, counted once.
  const average = averageServedMovements(state);
  const [atA] = nextSlotFees(state, a, 1, 0, average);
  const [atB] = nextSlotFees(state, b, 1, 0, average);
  if (atA === null || atB === null) return null;
  return Math.round(atA * rivalHeritageSurcharge(state, a) + atB * rivalHeritageSurcharge(state, b));
}

/** What a rival's fee at this airport is multiplied by, for the player's heritage pairs there (1 = nothing). */
export function rivalHeritageSurcharge(state: SimState, iata: string): number {
  return 1 + Math.min(HERITAGE_RIVAL_SURCHARGE_CAP, HERITAGE_RIVAL_SURCHARGE * heritageShare(state, iata));
}

export type SlotQuote = { iata: string; fees: number[]; full: boolean };

/**
 * What adding these departures would cost in new slots: for each airport
 * where the schedule would need more pairs than are held, the daily fee of
 * each extra pair, or `full` if the airport can't give them. The route
 * builder and the add-flight button both show this before anything is
 * committed.
 */
export function quoteSlots(
  state: SimState,
  departuresByAirport: Map<string, number>,
  arrivalsByAirport: Map<string, number>,
  legs: { origin: string; departMinute: number }[] = [],
): SlotQuote[] {
  const quotes: SlotQuote[] = [];
  const average = averageServedMovements(state);
  for (const [iata, departures] of departuresByAirport) {
    const shortfall = slotsNeeded(state, iata) + departures - slotsHeld(state, iata);
    if (shortfall <= 0) continue;
    // Traffic this same rotation adds before its own new pairs: every
    // movement it makes here beyond the ones those pairs cover.
    const ownMovements = departures + (arrivalsByAirport.get(iata) ?? 0) - shortfall * MOVEMENTS_PER_PAIR;
    // Priced at the hours this rotation departs from here: a peak slot costs more.
    const hours = airportHours(state, iata);
    const departing = legs.filter((leg) => leg.origin === iata);
    const multiplier =
      departing.length > 0 ? departing.reduce((sum, leg) => sum + hourPriceMultiplier(hours, hourOf(leg.departMinute)), 0) / departing.length : 1;
    const fees = nextSlotFees(state, iata, shortfall, Math.max(0, ownMovements), average, multiplier);
    quotes.push({ iata, fees: fees.filter((fee): fee is number => fee !== null), full: fees.includes(null) });
  }
  return quotes;
}

/**
 * Take the slot pairs a quote priced (quoteSlots(), above), at exactly
 * those fees. This is how a committed rotation gets its slots, so the
 * price locked in is the price the player was shown: re-pricing after the
 * rotation is on the schedule would differ slightly, because the new
 * traffic shifts the airport average everything is priced against.
 */
export function takeQuotedSlots(state: SimState, quotes: SlotQuote[]): void {
  for (const quote of quotes) {
    const held = (state.slotsHeld[quote.iata] ??= []);
    held.push(...quote.fees);
  }
}

/**
 * Take whatever slots the schedule needs and doesn't hold, at today's
 * prices, locking each fee. A backstop for schedules that didn't come
 * through a quote (the headless fixture, anything missed), run at every
 * rollover. An airport that's full simply grants what it
 * can; the route builder refuses a rotation that would need more.
 */
export function acquireNeededSlots(state: SimState): void {
  for (const airport of allAirports()) {
    const shortfall = slotsNeeded(state, airport.iata) - slotsHeld(state, airport.iata);
    if (shortfall <= 0) continue;
    // Priced as the schedule stands (the new flights already on it), less
    // the traffic of the pairs being taken, so the first pair at an
    // airport nobody else serves really is free.
    const fees = nextSlotFees(state, airport.iata, shortfall, -shortfall * MOVEMENTS_PER_PAIR);
    const held = (state.slotsHeld[airport.iata] ??= []);
    for (const fee of fees) held.push(fee ?? 0);
  }
}

/**
 * Daily rollover: give back slots nothing uses any more (most expensive
 * first), then return what the rest cost today. The caller charges it.
 */
export function settleSlotsForDay(state: SimState): number {
  const daysHeld = (state.slotDaysHeld ??= {});
  let total = 0;
  for (const iata of Object.keys(state.slotsHeld)) {
    const held = state.slotsHeld[iata];
    // Tenure runs alongside the fees by position. A pair added without it
    // (taken today, or from an older save) starts at 0; extras are dropped.
    const days = daysHeld[iata] ?? [];
    while (days.length < held.length) days.push(0);
    days.length = held.length;
    const unused = held.length - slotsNeeded(state, iata);
    if (unused > 0) {
      const dearestFirst = held.map((_, index) => index).sort((a, b) => held[b] - held[a] || b - a);
      const giveBack = dearestFirst.slice(0, unused).sort((a, b) => b - a);
      for (const index of giveBack) {
        held.splice(index, 1);
        days.splice(index, 1);
      }
    }
    if (held.length === 0) {
      delete state.slotsHeld[iata];
      delete daysHeld[iata];
      continue;
    }
    daysHeld[iata] = days.map((count) => count + 1);
    total += slotFeesPerDayAt(state, iata);
  }
  for (const iata of Object.keys(daysHeld)) if (!state.slotsHeld[iata]) delete daysHeld[iata];
  return total;
}
