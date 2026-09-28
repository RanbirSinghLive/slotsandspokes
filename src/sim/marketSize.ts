import { actualDailyDemand, currentPotentialDemand } from './marketDemand';
import type { SimState } from './state';

/**
 * Markets in words, not passenger counts. Before you fly a route you know
 * roughly how big the city pair is; how many actually fly it, and how full
 * your planes get, you learn by flying (WEEK-NINE.md, thread 2). A number
 * to the passenger made route choice a sort by the biggest figure. A size
 * makes it a judgement.
 *
 * What the player observes on their own flights (passengers carried, how
 * full, how many turned away) stays in numbers everywhere: those are
 * facts about their airline, not about the market.
 */

export type Size = 'Tiny' | 'Small' | 'Medium' | 'Large' | 'Huge';
const SIZES: Size[] = ['Tiny', 'Small', 'Medium', 'Large', 'Huge'];

/**
 * Upper bounds, in potential riders a day both ways, for Tiny to Large.
 * From the spread of city pairs within 1,500 nm: Tiny is about the bottom
 * quarter (Halifax–Charlottetown, 32), fewer than one full Propeller round
 * trip; Huge is about the top 2% (Montréal–Toronto, 4,400;
 * LaGuardia–Boston, 13,900).
 */
const MARKET_SIZE_BOUNDS = [40, 150, 600, 3000];

/**
 * Upper bounds for an airport's riders waiting across all its city pairs
 * (sim/unmetDemand.ts's latent figure), Tiny to Large: about the 10th,
 * 25th, 50th and 85th percentiles of the map (Moncton 2,600, Prague
 * 26,000; London 191,000 is Huge).
 */
const AIRPORT_SIZE_BOUNDS = [3000, 8000, 20000, 60000];

function sizeOf(value: number, bounds: number[]): Size {
  const index = bounds.findIndex((bound) => value < bound);
  return SIZES[index === -1 ? SIZES.length - 1 : index];
}

/** How big a city pair is, in words: its potential, grown as the game goes on. */
export function marketSize(state: SimState, a: string, b: string): Size {
  return sizeOf(currentPotentialDemand(state, a, b), MARKET_SIZE_BOUNDS);
}

/** How many people are waiting to fly from an airport, in words. `waiting` is its latent riders a day. */
export function airportDemandSize(waiting: number): Size {
  return sizeOf(waiting, AIRPORT_SIZE_BOUNDS);
}

/** A size's place in the order, for sorting a list by it. */
export function sizeRank(size: Size): number {
  return SIZES.indexOf(size);
}

export type DemandAgainstSeats = {
  words: string;
  /** More people want to fly than the seats hold. */
  short: boolean;
  /** Flights would leave mostly empty: the market isn't built yet (or never will be, if it's small). */
  thin: boolean;
};

/**
 * Today's demand per flight against a plane's seats, in words: whether a
 * route's planes would fill. `flights` is the market's flights a day with
 * whatever is being judged added. Uses actual demand, which a player can't
 * see as a number but reads from how full their planes are.
 */
export function demandAgainstSeats(state: SimState, a: string, b: string, flights: number, seats: number): DemandAgainstSeats {
  const perFlight = actualDailyDemand(state, a, b) / Math.max(1, flights);
  if (perFlight > seats) return { words: 'demand exceeds seats', short: true, thin: false };
  if (perFlight >= 0.6 * seats) return { words: 'fills most seats', short: false, thin: false };
  if (perFlight >= 0.3 * seats) return { words: 'about half full now', short: false, thin: false };
  return { words: 'mostly empty now', short: false, thin: true };
}

/**
 * Whether a market could ever fill a plane with these seats, flown this
 * many times a day, once fully grown. For the "thin market" warning.
 */
export function neverFills(state: SimState, a: string, b: string, flights: number, seats: number): boolean {
  return currentPotentialDemand(state, a, b) / Math.max(1, flights) < seats;
}
