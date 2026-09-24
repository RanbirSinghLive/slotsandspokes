import airportsData from '../../data/airports.json';
import type { SimState } from './state';
import { SLOTS_ENABLED } from './features';

/**
 * Week six's airport layer: how much of an airline you are *at each
 * airport*, what that concentration is worth, and — at the two fields on
 * this map that are genuinely slot-controlled in real life — how much
 * room you've actually bought to grow there.
 *
 * The connectivity multiplier is the interesting half. Real airlines
 * concentrate flying at hubs because a passenger arriving on one flight
 * can leave on another, and the value of that grows with how many
 * departures meet there. This sim doesn't model connecting itineraries
 * (WEEK-TWO.md decision 1, still the heaviest structural lift on any
 * list), so this is a deliberate stand-in: the *benefit* of a hub without
 * the machinery of tracking itineraries through one. It rewards
 * concentration over scattering, which is the strategic pressure a hub is
 * supposed to create.
 */

type AirportSpec = { iata: string; name: string; population: number; slotsTotal?: number; capacityPerDay?: number };
const airports = airportsData as AirportSpec[];
const byIata = new Map(airports.map((a) => [a.iata, a]));

/**
 * How much a fully-built hub is worth on revenue, and how fast it gets
 * there. `log2` for the same diminishing returns every other bonus in
 * this sim uses — the tenth daily departure at an airport is worth much
 * less than the second.
 *
 * Capped deliberately low. This is a proxy for connecting traffic, not a
 * measurement of it, and an uncapped network effect would make a single
 * mega-hub strictly correct and every other shape of airline wrong.
 */
const CONNECTIVITY_WEIGHT = 0.06;
const CONNECTIVITY_SCALE = 4;
const CONNECTIVITY_MAX = 1.25;

/** Slot pricing escalates with how many you already hold — scarcity, and a brake on buying a whole airport at once. */
const SLOT_BASE_PRICE = 45_000;
const SLOT_PRICE_ESCALATION = 1.4;

export type AirportLevel = 'Unserved' | 'Outstation' | 'Focus city' | 'Base' | 'Hub';

/** Daily departures the airline operates from this airport. The input to everything below. */
export function dailyDeparturesAt(state: SimState, iata: string): number {
  return state.schedule.filter((leg) => leg.origin === iata).length;
}

/**
 * A label for the airline's presence, derived rather than stored — it's
 * a reading of the schedule, so it can never drift from what's actually
 * flown.
 */
export function airportLevel(departures: number): AirportLevel {
  if (departures === 0) return 'Unserved';
  if (departures <= 2) return 'Outstation';
  if (departures <= 5) return 'Focus city';
  if (departures <= 9) return 'Base';
  return 'Hub';
}

/** Revenue multiplier earned by concentration at one airport. 1 when unserved. */
export function connectivityFactor(state: SimState, iata: string): number {
  const departures = dailyDeparturesAt(state, iata);
  if (departures === 0) return 1;
  return Math.min(CONNECTIVITY_MAX, 1 + CONNECTIVITY_WEIGHT * Math.log2(1 + departures / CONNECTIVITY_SCALE));
}

/**
 * What a single flight earns from connectivity — the average of its two
 * ends. Averaged rather than multiplied so a hub-to-outstation flight
 * gets half the benefit of a hub-to-hub one, rather than the two
 * compounding into something much larger than either.
 */
export function routeConnectivityMultiplier(state: SimState, origin: string, dest: string): number {
  return (connectivityFactor(state, origin) + connectivityFactor(state, dest)) / 2;
}

// --- Capacity and load ---------------------------------------------------

/**
 * How many takeoffs and landings a day this airport has room for, at the
 * game's scale: the share of the field available to the airlines in this
 * game, not its real-world total (YYZ really handles about 1,200 a day).
 * Grows with the catchment's population on a log curve, so a big city's
 * airport has several times a small one's room, not a hundred times.
 *
 * This is the one number congestion delays (sim/delays.ts), and next,
 * slot prices, are read against — see `airportLoad()`.
 *
 * An airport can override it in data/airports.json (`capacityPerDay`)
 * where the city's size says nothing about the field: Billy Bishop shares
 * Toronto's population but is a small island airport.
 */
const CAPACITY_BASE = 18;
const CAPACITY_PER_DOUBLING = 54;
const CAPACITY_POPULATION_SCALE = 250_000;

export function airportCapacityPerDay(iata: string): number {
  const spec = byIata.get(iata);
  if (spec?.capacityPerDay !== undefined) return spec.capacityPerDay;
  const population = spec?.population ?? 0;
  return Math.round(CAPACITY_BASE + CAPACITY_PER_DOUBLING * Math.log2(1 + population / CAPACITY_POPULATION_SCALE));
}

/**
 * Takeoffs plus landings a day at this airport, every airline counted:
 * the player's scheduled legs from and to it, plus each competitor route
 * touching it. Competitors have frequencies but no times, so each daily
 * frequency counts as one round trip: a takeoff and a landing at each end.
 */
export function dailyMovementsAt(state: SimState, iata: string): number {
  let movements = 0;
  for (const leg of state.schedule) {
    if (leg.origin === iata) movements += 1;
    if (leg.dest === iata) movements += 1;
  }
  for (const route of state.competitorRoutes) {
    if (route.origin === iata || route.dest === iata) movements += 2 * route.dailyFrequency;
  }
  return movements;
}

/**
 * Traffic isn't spread evenly across the day: it bunches into morning and
 * evening peaks. Load is judged at the peak, which runs this much busier
 * than the daily average. One constant for every airport for now; hub
 * styles (banked vs rolling) will vary it later.
 */
const PEAK_FACTOR = 1.5;

/**
 * How full the airport is at its busiest: peak movements over capacity.
 * 0.5 is comfortably busy, 1 is full, above 1 is more traffic than the
 * field can take without queueing. Drives congestion delays.
 */
export function airportLoad(state: SimState, iata: string): number {
  const capacity = airportCapacityPerDay(iata);
  if (capacity <= 0) return 0;
  return (dailyMovementsAt(state, iata) * PEAK_FACTOR) / capacity;
}

// --- Slots ------------------------------------------------------------

/** Total slots that exist at this airport, or null where slots aren't controlled at all. */
export function slotsTotal(iata: string): number | null {
  if (!SLOTS_ENABLED) return null;
  return byIata.get(iata)?.slotsTotal ?? null;
}

export function isSlotControlled(iata: string): boolean {
  return slotsTotal(iata) !== null;
}

export function slotsOwned(state: SimState, iata: string): number {
  return state.slotsOwned[iata] ?? 0;
}

/** What the next slot at this airport costs — rises with each one already held. */
export function nextSlotPrice(state: SimState, iata: string): number {
  return Math.round(SLOT_BASE_PRICE * Math.pow(SLOT_PRICE_ESCALATION, slotsOwned(state, iata)));
}

/** Whether another slot can be bought here at all: controlled, not sold out, and affordable. */
export function canBuySlot(state: SimState, iata: string): boolean {
  const total = slotsTotal(iata);
  if (total === null) return false;
  if (slotsOwned(state, iata) >= total) return false;
  return state.cash >= nextSlotPrice(state, iata);
}

export function buySlot(state: SimState, iata: string): void {
  if (!canBuySlot(state, iata)) return; // UI gates this; guard against a stale click
  state.cash -= nextSlotPrice(state, iata);
  state.slotsOwned[iata] = slotsOwned(state, iata) + 1;
}

/**
 * How many more departures the airline may add at this airport.
 * `Infinity` where slots aren't controlled, which is most of the map —
 * callers can compare against it without special-casing.
 */
export function remainingSlotCapacity(state: SimState, iata: string): number {
  if (!isSlotControlled(iata)) return Number.POSITIVE_INFINITY;
  return slotsOwned(state, iata) - dailyDeparturesAt(state, iata);
}

/** Every slot-controlled airport, for the Airports tab to list separately. */
export function slotControlledAirports(): AirportSpec[] {
  return airports.filter((a) => a.slotsTotal !== undefined);
}

export function allAirports(): AirportSpec[] {
  return airports;
}
