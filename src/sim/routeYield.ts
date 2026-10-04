import { marketDistanceNm } from './demand';
import { LOAD_WINDOW_DAYS } from './loadFactor';
import { marketKey } from './schedule';
import type { SimState } from './state';

/**
 * A route's frequency and yield, as the map and the route views quote them.
 *
 * Frequency is per direction: a plane flying A-B-A once a day is "1/day",
 * not two legs. Yield is what each passenger pays per nautical mile flown,
 * in cents, over the last LOAD_WINDOW_DAYS finished days, so a long route
 * and a short one can be compared on fare alone.
 */

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
 * Revenue per passenger per nautical mile over the last week, in cents, or
 * null when the route has carried nobody in the window.
 */
export function marketYieldCents(state: SimState, a: string, b: string, days = LOAD_WINDOW_DAYS): number | null {
  const key = marketKey(a, b);
  const revenue = (state.revenueHistoryByMarket[key] ?? []).slice(-days).reduce((sum, n) => sum + n, 0);
  const passengers = (state.loadHistoryByMarket?.[key]?.passengers ?? []).slice(-days).reduce((sum, n) => sum + n, 0);
  if (passengers <= 0) return null;
  return (revenue / (passengers * marketDistanceNm(a, b))) * 100;
}

/** Yield as shown: "14.2¢", or a dash before the route has carried anyone. */
export function formatYield(cents: number | null): string {
  return cents === null ? '—' : `${cents.toFixed(1)}¢`;
}
