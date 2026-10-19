import { marketDistanceNm } from './demand';
import { LOAD_WINDOW_DAYS } from './loadFactor';
import { AIRCRAFT_CLASSES, classRank } from './aircraftClasses';
import { legDailyWeight, marketKey } from './schedule';
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

/** Daily flights each way on a market: [a to b, b to a]. An alternate-day leg counts as half a flight. */
export function flightsEachWay(state: SimState, a: string, b: string): [number, number] {
  let out = 0;
  let back = 0;
  for (const leg of state.schedule) {
    if (leg.origin === a && leg.dest === b) out += legDailyWeight(leg);
    else if (leg.origin === b && leg.dest === a) back += legDailyWeight(leg);
  }
  return [out, back];
}

/** A daily count as written: "2", "½", "1½". */
export function perDayCount(count: number): string {
  const whole = Math.floor(count);
  const half = count - whole >= 0.5;
  if (!half) return String(whole);
  return whole === 0 ? '½' : `${whole}½`;
}

/** "2/day", or "2/1/day" on a route flown more one way than the other. */
export function formatFrequency(state: SimState, a: string, b: string): string {
  const [out, back] = flightsEachWay(state, a, b);
  return out === back ? `${perDayCount(out)}/day` : `${perDayCount(out)}/${perDayCount(back)}/day`;
}

/** Daily flights each way flown by one aircraft size class. */
export type GaugeFlights = { code: string; name: string; out: number; back: number };

/** A market's daily flights split by the size class of the plane flying each leg, smallest first. */
export function flightsByGauge(state: SimState, a: string, b: string): GaugeFlights[] {
  const typeOfTail = new Map(state.aircraft.map((plane) => [plane.tail, plane.typeCode]));
  const byCode = new Map<string, GaugeFlights>();
  for (const leg of state.schedule) {
    const out = leg.origin === a && leg.dest === b;
    const back = leg.origin === b && leg.dest === a;
    if (!out && !back) continue;
    const code = typeOfTail.get(leg.tail) ?? AIRCRAFT_CLASSES[0].code;
    const entry = byCode.get(code) ?? { code, name: AIRCRAFT_CLASSES.find((c) => c.code === code)?.name ?? code, out: 0, back: 0 };
    if (out) entry.out += legDailyWeight(leg);
    else entry.back += legDailyWeight(leg);
    byCode.set(code, entry);
  }
  return [...byCode.values()].sort((x, y) => classRank(x.code) - classRank(y.code));
}

/** Adds up per-gauge flights over several routes, smallest class first. */
export function sumGaugeFlights(lists: GaugeFlights[][]): GaugeFlights[] {
  const byCode = new Map<string, GaugeFlights>();
  for (const entry of lists.flat()) {
    const sum = byCode.get(entry.code) ?? { ...entry, out: 0, back: 0 };
    sum.out += entry.out;
    sum.back += entry.back;
    byCode.set(entry.code, sum);
  }
  return [...byCode.values()].sort((x, y) => classRank(x.code) - classRank(y.code));
}

/** One gauge's flights as written: "Regional 2/day" or "Regional 2/1/day". */
export function gaugeFlightsText(entry: GaugeFlights): string {
  const count = entry.out === entry.back ? perDayCount(entry.out) : `${perDayCount(entry.out)}/${perDayCount(entry.back)}`;
  return `${entry.name} ${count}/day`;
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
