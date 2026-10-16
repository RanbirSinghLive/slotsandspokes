import type { SimState } from './state';

/**
 * A route's frequency, as the map and the route views quote it.
 *
 * Frequency is per direction: a plane flying A-B-A once a day is "1/day",
 * not two legs.
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
