import aircraftTypesData from '../../data/aircraft-types.json';
import { marketKey, recommendedFare } from './schedule';
import { COMPETITOR_ASSUMED_SEATS } from './serviceLevel';
import type { SimState } from './state';

const seatsByTypeCode = new Map((aircraftTypesData as Array<{ code: string; seats: number }>).map((type) => [type.code, type.seats]));

/**
 * Low fares grow markets (WEEK-FOURTEEN.md, stage 3). How a market grows
 * (sim/marketDemand.ts) follows the fares flown on it: everyone's,
 * yours and your rivals', weighted by their seats, against the going
 * rate. Cheap fares bring people who wouldn't otherwise fly, so the
 * market builds faster and settles bigger; dear ones put them off.
 *
 * The market is everyone's, so a market built on cheap fares is one a
 * rival can enter and share: building it is an investment, not a moat.
 */

/** Growth speed at a fare level: the level to this power, so 80% of the going rate builds about 1.6× as fast and 120% about 0.7×. */
const GROWTH_EXPONENT = -2;
const GROWTH_MIN = 0.4;
const GROWTH_MAX = 2.5;

/** Where a market settles, as a share of its potential: 1 + this × (1 − level), so 70% of the going rate settles 1.24× bigger. */
const SIZE_PER_LEVEL = 0.8;
export const SIZE_MIN = 0.8;
export const SIZE_MAX = 1.3;

/** A plane's or a rival flight's seats, as sim/serviceLevel.ts counts them. */
export type MarketSeats = { seats: number; fare: number }[];

/** The seat-weighted fare flown on a market, as a share of its going rate; null with no seats. */
export function fareLevel(origin: string, dest: string, offers: MarketSeats): number | null {
  const seats = offers.reduce((sum, offer) => sum + offer.seats, 0);
  if (seats <= 0) return null;
  const fare = offers.reduce((sum, offer) => sum + offer.seats * offer.fare, 0) / seats;
  return fare / recommendedFare(origin, dest);
}

/** How much faster (or slower) a market builds at this fare level. */
export function growthFromFare(level: number | null): number {
  if (level === null || level <= 0) return 1;
  return Math.min(GROWTH_MAX, Math.max(GROWTH_MIN, level ** GROWTH_EXPONENT));
}

/** Where a market settles at this fare level, as a share of its potential. */
export function sizeFromFare(level: number | null): number {
  if (level === null) return 1;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, 1 + SIZE_PER_LEVEL * (1 - level)));
}

/** Every market's offers today: your legs at your fare, each rival's flights at theirs, seats counted as sim/serviceLevel.ts counts them. */
export function offersByMarket(state: SimState): Map<string, MarketSeats> {
  const seatsByTail = new Map(state.aircraft.map((a) => [a.tail, seatsByTypeCode.get(a.typeCode) ?? 0]));
  const offers = new Map<string, MarketSeats>();
  const add = (key: string, seats: number, fare: number) => {
    const list = offers.get(key);
    if (list) list.push({ seats, fare });
    else offers.set(key, [{ seats, fare }]);
  };
  for (const leg of state.schedule) {
    const seats = seatsByTail.get(leg.tail);
    const key = marketKey(leg.origin, leg.dest);
    const fare = state.routeSettings[key]?.fare;
    if (seats && fare) add(key, seats, fare);
  }
  for (const route of state.competitorRoutes) {
    if (route.dailyFrequency > 0) add(marketKey(route.origin, route.dest), route.dailyFrequency * COMPETITOR_ASSUMED_SEATS, route.fare);
  }
  return offers;
}

/** One market's fare level today (for the route view). */
export function marketFareLevel(state: SimState, origin: string, dest: string): number | null {
  return fareLevel(origin, dest, offersByMarket(state).get(marketKey(origin, dest)) ?? []);
}
