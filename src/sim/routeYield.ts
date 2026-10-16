import { marketDistanceNm } from './demand';
import { LOAD_WINDOW_DAYS } from './loadFactor';
import { marketKey } from './schedule';
import type { SimState } from './state';

/**
 * A route's frequency and PRASM, as the map and the route views quote them.
 *
 * Frequency is per direction: a plane flying A-B-A once a day is "1/day",
 * not two legs. PRASM is profit per available seat-mile, in cents, over the
 * last LOAD_WINDOW_DAYS finished days. Fare per mile is no use for comparing
 * routes (the fare has a fixed part, so short routes always read high);
 * profit over seats flown pays for the plane's size and the route's length
 * at once.
 */

const STATUTE_MILES_PER_NM = 1.15078;

/** Daily flights each way on a market: [a to b, b to a]. */
export function flightsEachWay(state: SimState, a: string, b: string): [number, number] {
  let out = 0;
  let back = 0;
  for (const leg of state.schedule) {
    if (leg.origin === a && leg.dest === b) out++;
    else if (leg.origin === b && leg.dest === a) back++;
  }
  return [out, back];
}

/** "2/day", or "2/1/day" on a route flown more one way than the other. */
export function formatFrequency(state: SimState, a: string, b: string): string {
  const [out, back] = flightsEachWay(state, a, b);
  return out === back ? `${out}/day` : `${out}/${back}/day`;
}

/**
 * Profit (revenue less cost) per available seat-mile over the last week, in
 * cents, or null when no seats flew in the window.
 */
export function marketPrasmCents(state: SimState, a: string, b: string, days = LOAD_WINDOW_DAYS): number | null {
  const key = marketKey(a, b);
  const revenue = (state.revenueHistoryByMarket[key] ?? []).slice(-days);
  const cost = (state.costHistoryByMarket[key] ?? []).slice(-days);
  const seats = (state.loadHistoryByMarket?.[key]?.seats ?? []).slice(-days).reduce((sum, n) => sum + n, 0);
  if (seats <= 0) return null;
  const profit = revenue.reduce((sum, r, i) => sum + r - (cost[i] ?? 0), 0);
  return (profit / (seats * marketDistanceNm(a, b) * STATUTE_MILES_PER_NM)) * 100;
}

/** PRASM as shown: "1.8¢", "−0.4¢", or a dash before the route has flown. */
export function formatPrasm(cents: number | null): string {
  return cents === null ? '—' : `${cents < 0 ? '−' : ''}${Math.abs(cents).toFixed(1)}¢`;
}
