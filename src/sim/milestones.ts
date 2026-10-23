import { LOAD_WINDOW_DAYS } from './loadFactor';
import { ROUTE_OTP_WINDOW_DAYS } from './routeOtp';
import { marketKey } from './schedule';
import type { SimState } from './state';

/**
 * Milestones: the moments a route or an airport crosses a line worth a
 * small celebration on the map (render/milestones.ts pops them). Each is
 * judged over a trailing week, never one flight, so a pop means the
 * network has really grown and a single lucky departure can't trigger one.
 *
 * Read entirely from the daily histories (sim/loadFactor.ts,
 * sim/routeOtp.ts): this week (the last 7 finished days) against each of
 * the weeks that ended one to RECENT_WINDOWS days earlier. A milestone is
 * a line this week is over and none of those was, so each fires on the
 * rollover where it was crossed, a route hovering on a line doesn't pop
 * every other day, and nothing needs storing to remember what fired.
 * Only upward crossings count; colours on the map already show a decline.
 */

/** Load factor lines a route pops at, over a trailing week. */
export const LOAD_MILESTONES = [0.6, 0.75, 0.85];
/** On-time share a route pops at, over a trailing week. */
export const ON_TIME_MILESTONE = 0.9;
/** Passengers a day through an airport, over a trailing week, that it pops at. */
export const AIRPORT_PAX_MILESTONES = [50, 100, 250, 500, 1000, 2500, 5000, 10000];

// A route needs this many days in last week's window before a crossing
// counts, so a brand-new route's first full flight doesn't pop.
const MIN_PREVIOUS_DAYS = 3;
const MIN_FLIGHTS = 5;
// How many earlier weeks (each ending a day before the last) must all have been under a line.
const RECENT_WINDOWS = 7;

export type Milestone =
  | { kind: 'load'; a: string; b: string; level: number }
  | { kind: 'onTime'; a: string; b: string; level: number }
  | { kind: 'airport'; iata: string; level: number };

/** The sum of `values` over a window of `days` ending `endOffset` days before the newest. */
function windowSum(values: number[] | undefined, days: number, endOffset: number): number {
  if (!values) return 0;
  const end = values.length - endOffset;
  return values.slice(Math.max(0, end - days), Math.max(0, end)).reduce((sum, n) => sum + n, 0);
}

function highestLevelReached(levels: number[], value: number): number | null {
  let reached: number | null = null;
  for (const level of levels) if (value >= level) reached = level;
  return reached;
}

/** Each value over the trailing week ending `offset` days back, for offset 0 (this week) to RECENT_WINDOWS. */
function weeksBack(ratio: (offset: number) => number | null): { now: number | null; recentBest: number | null } {
  let recentBest: number | null = null;
  for (let offset = 1; offset <= RECENT_WINDOWS; offset++) {
    const value = ratio(offset);
    if (value !== null && (recentBest === null || value > recentBest)) recentBest = value;
  }
  return { now: ratio(0), recentBest };
}

/** The highest line in `levels` that `now` is over and `recentBest` was not, or null. */
function crossed(levels: number[], now: number | null, recentBest: number | null): number | null {
  if (now === null || recentBest === null) return null;
  const reached = highestLevelReached(levels, now);
  const before = highestLevelReached(levels, recentBest);
  return reached !== null && (before === null || reached > before) ? reached : null;
}

/** The milestones crossed at the most recent rollover, routes first then airports. */
export function milestonesAtLastRollover(state: SimState): Milestone[] {
  const found: Milestone[] = [];
  const markets = new Map<string, { a: string; b: string }>();
  for (const leg of state.schedule) {
    const key = marketKey(leg.origin, leg.dest);
    if (!markets.has(key)) markets.set(key, { a: leg.origin, b: leg.dest });
  }

  for (const [key, { a, b }] of markets) {
    const load = state.loadHistoryByMarket?.[key];
    if (load && load.seats.length - 1 >= MIN_PREVIOUS_DAYS) {
      const { now, recentBest } = weeksBack((offset) => {
        if (load.seats.length - offset < MIN_PREVIOUS_DAYS && offset > 0) return null;
        const seats = windowSum(load.seats, LOAD_WINDOW_DAYS, offset);
        return seats > 0 ? windowSum(load.passengers, LOAD_WINDOW_DAYS, offset) / seats : null;
      });
      const level = crossed(LOAD_MILESTONES, now, recentBest);
      if (level !== null) found.push({ kind: 'load', a, b, level });
    }

    const otp = state.onTimeHistoryByMarket[key];
    if (otp && otp.arrived.length - 1 >= MIN_PREVIOUS_DAYS) {
      const { now, recentBest } = weeksBack((offset) => {
        const flights = windowSum(otp.arrived, ROUTE_OTP_WINDOW_DAYS, offset) + windowSum(otp.cancelled, ROUTE_OTP_WINDOW_DAYS, offset);
        return flights >= MIN_FLIGHTS ? windowSum(otp.onTime, ROUTE_OTP_WINDOW_DAYS, offset) / flights : null;
      });
      if (crossed([ON_TIME_MILESTONE], now, recentBest) !== null) found.push({ kind: 'onTime', a, b, level: ON_TIME_MILESTONE });
    }
  }

  // An airport's passengers a day: every passenger on one of its routes, averaged over the days in each window.
  const networkDays = state.loadHistory?.passengers.length ?? 0;
  const airportsServed = new Set([...markets.values()].flatMap(({ a, b }) => [a, b]));
  for (const iata of airportsServed) {
    const { now, recentBest } = weeksBack((offset) => {
      const days = Math.min(LOAD_WINDOW_DAYS, networkDays - offset);
      if (days <= 0 || (offset > 0 && days < MIN_PREVIOUS_DAYS)) return null;
      let passengers = 0;
      for (const [key, { a, b }] of markets) {
        if (a === iata || b === iata) passengers += windowSum(state.loadHistoryByMarket?.[key]?.passengers, LOAD_WINDOW_DAYS, offset);
      }
      return passengers / days;
    });
    const level = crossed(AIRPORT_PAX_MILESTONES, now, recentBest);
    if (level !== null) found.push({ kind: 'airport', iata, level });
  }
  return found;
}

/** A route's load factor this week and the week before, for the map's trend mark. Null where either week flew nothing. */
export function weekOnWeekLoad(state: SimState, a: string, b: string): { now: number; before: number } | null {
  const load = state.loadHistoryByMarket?.[marketKey(a, b)];
  if (!load) return null;
  const seatsNow = windowSum(load.seats, LOAD_WINDOW_DAYS, 0);
  const seatsBefore = windowSum(load.seats, LOAD_WINDOW_DAYS, LOAD_WINDOW_DAYS);
  if (seatsNow <= 0 || seatsBefore <= 0) return null;
  return {
    now: windowSum(load.passengers, LOAD_WINDOW_DAYS, 0) / seatsNow,
    before: windowSum(load.passengers, LOAD_WINDOW_DAYS, LOAD_WINDOW_DAYS) / seatsBefore,
  };
}
