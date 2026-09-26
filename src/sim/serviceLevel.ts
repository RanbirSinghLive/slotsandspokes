import aircraftTypesData from '../../data/aircraft-types.json';
import { ALL_MARKET_PAIRS, potentialDailyDemand } from './demand';
import { marketKey } from './schedule';
import type { SimState } from './state';

/**
 * How well served each airport is: the seats every airline offers there
 * against how many people there would fly. There are no incumbent
 * airlines in this world, only the player and rival start-ups, so at the
 * start every airport is starved, and the ones nobody has reached yet stay
 * that way. A starved airport is an edge (CLAUDE.md, the game's
 * philosophy): routes there build their market faster
 * (sim/marketDemand.ts), and the edge wears off as someone, you or a
 * rival, serves it.
 */

/**
 * Seats a competitor frequency is assumed to carry. Competitors have no
 * fleet in this model — `CompetitorOffering` (sim/competitors.ts) carries
 * a frequency and a fare but no aircraft type — so their contribution to
 * stimulating a market needs a stand-in gauge. A small-regional number,
 * between the propeller and regional classes the player can buy, on the reasoning that
 * competitors here are peer startups flying comparable equipment rather
 * than mainline carriers.
 */
const COMPETITOR_ASSUMED_SEATS = 50;

const seatsByTypeCode = new Map<string, number>(
  (aircraftTypesData as { code: string; seats: number }[]).map((type) => [type.code, type.seats]),
);

/**
 * Total daily seats every airline puts into each market, keyed by
 * marketKey() — the player's scheduled legs at their real aircraft's
 * gauge, plus each competitor's frequency at an assumed one. This is what
 * drives stimulation: seats, not frequencies, because "is this market
 * genuinely served" is a question about capacity offered, and one daily
 * 19-seater means something very different on a 9-PDEW market than on a
 * 4,600-PDEW one.
 *
 * Every market at once, because the daily pass needs every pair, and one
 * walk of the schedule is far cheaper than one walk per pair.
 */
export function dailySeatsByMarket(state: SimState): Map<string, number> {
  const seatsByTail = new Map(state.aircraft.map((a) => [a.tail, seatsByTypeCode.get(a.typeCode) ?? 0]));
  const seats = new Map<string, number>();
  const add = (key: string, count: number) => seats.set(key, (seats.get(key) ?? 0) + count);

  for (const leg of state.schedule) {
    const tailSeats = seatsByTail.get(leg.tail);
    if (tailSeats === undefined) continue; // a scheduled leg with no aircraft to fly it offers nothing
    add(marketKey(leg.origin, leg.dest), tailSeats);
  }
  for (const competitor of state.competitorRoutes) {
    add(marketKey(competitor.origin, competitor.dest), competitor.dailyFrequency * COMPETITOR_ASSUMED_SEATS);
  }
  return seats;
}

/**
 * Seats a day, per potential passenger a day, at which an airport counts
 * as well served. The gravity model's potential is far above anything a
 * start-up airline carries (LaGuardia's is about 350,000 a day), so this
 * is a benchmark, not a share of the market. It's set where an airport
 * someone flies hard gets there: the steady headless player's home
 * reaches about 0.05 by day 120, and Toronto and O'Hare, flown by it and
 * rivals, about 0.005. At 0.02 almost nothing ever counted as served, so
 * the boost never wore off. Hunger falls from 1 at no seats to 0 here.
 */
export const WELL_SERVED_SEATS_PER_POTENTIAL = 0.005;

/** The most hunger speeds up a route's growth: both ends fully starved. */
export const MAX_HUNGER_BOOST = 3;

/** Every airport's potential passengers a day before demand growth, summed over its city pairs once. */
const basePotentialByAirport = new Map<string, number>();
for (const [a, b] of ALL_MARKET_PAIRS) {
  const potential = potentialDailyDemand(a, b);
  basePotentialByAirport.set(a, (basePotentialByAirport.get(a) ?? 0) + potential);
  basePotentialByAirport.set(b, (basePotentialByAirport.get(b) ?? 0) + potential);
}

/**
 * How starved each airport is for service, 0 (well served) to 1 (nobody
 * flies there), for every airport with any potential. `seatsByMarket` is
 * dailySeatsByMarket(), passed in so the daily demand pass works it out
 * once.
 */
export function hungerByAirport(state: SimState, seatsByMarket: Map<string, number> = dailySeatsByMarket(state)): Map<string, number> {
  const seatsByAirport = new Map<string, number>();
  for (const [key, seats] of seatsByMarket) {
    const [a, b] = key.split('-');
    seatsByAirport.set(a, (seatsByAirport.get(a) ?? 0) + seats);
    seatsByAirport.set(b, (seatsByAirport.get(b) ?? 0) + seats);
  }
  const hunger = new Map<string, number>();
  for (const [iata, basePotential] of basePotentialByAirport) {
    const potential = basePotential * state.demandGrowthMultiplier;
    const served = potential > 0 ? (seatsByAirport.get(iata) ?? 0) / potential : 1;
    hunger.set(iata, 1 - Math.min(1, served / WELL_SERVED_SEATS_PER_POTENTIAL));
  }
  return hunger;
}

/** How starved one airport is, 0–1. */
export function hungerAt(state: SimState, iata: string): number {
  return hungerByAirport(state).get(iata) ?? 0;
}

/**
 * The multiplier on a market's growth rate from its two airports' hunger:
 * 1 when both are well served, MAX_HUNGER_BOOST when both are starved,
 * their average in between.
 */
export function hungerBoost(hunger: Map<string, number>, a: string, b: string): number {
  const average = ((hunger.get(a) ?? 0) + (hunger.get(b) ?? 0)) / 2;
  return 1 + (MAX_HUNGER_BOOST - 1) * average;
}

export type ServiceLevel = { label: string; description: string };

/** An airport's hunger in words, for the airport view. */
export function describeServiceLevel(hunger: number): ServiceLevel {
  if (hunger >= 0.75) return { label: 'Starved for service', description: 'almost nobody flies here yet, so new routes build their market fast' };
  if (hunger >= 0.25) return { label: 'Underserved', description: 'new routes build their market faster than usual' };
  return { label: 'Well served', description: 'new routes build their market at the normal pace' };
}
