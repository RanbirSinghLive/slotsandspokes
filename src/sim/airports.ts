import airportsData from '../../data/airports.json';
import type { SimState } from './state';
import { airportHours, hourLoad, peakHour } from './hours';

/**
 * Airport layer: how much of an airline you are *at each
 * airport*, what that concentration is worth, and how much room the
 * airport has (capacity and load). Slots, priced from that same load,
 * live in sim/slots.ts.
 *
 * What a hub is worth — connecting passengers — lives in sim/hubs.ts: a
 * hub earns from what actually connects through it, not from its size.
 */

type AirportSpec = { iata: string; name: string; population: number; capacityPerDay?: number };
const airports = airportsData as AirportSpec[];
const byIata = new Map(airports.map((a) => [a.iata, a]));

export type AirportLevel = 'Not in your network' | 'Outstation' | 'Focus city' | 'Base' | 'Hub';

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
  if (departures === 0) return 'Not in your network';
  if (departures <= 2) return 'Outstation';
  if (departures <= 5) return 'Focus city';
  if (departures <= 9) return 'Base';
  return 'Hub';
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
 * where the city's size says little about the field: LaGuardia serves
 * all of New York but is one crowded airport.
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
 * How full the airport is at its busiest hour: that hour's movements, every
 * airline's, over the hour's room (sim/hours.ts). 0.5 is comfortably busy,
 * 1 is full, above 1 is more traffic than the field can take without
 * queueing. Drives the airport's ring on the map and the busy-airport
 * milestones; a leg's own congestion reads the hour it flies in
 * (`airportLoadAt()`).
 */
export function airportLoad(state: SimState, iata: string): number {
  return peakHour(airportHours(state, iata)).load;
}

/** How full the airport is in one hour of the day (0–23, home clock). */
export function airportLoadAt(state: SimState, iata: string, hour: number): number {
  return hourLoad(airportHours(state, iata), hour);
}

export function allAirports(): AirportSpec[] {
  return airports;
}
