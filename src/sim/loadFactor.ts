import { PNL_HISTORY_MAX_DAYS } from './pnlHistory';
import { marketKey } from './schedule';
import type { SimState } from './state';

/**
 * Load factor: the passengers carried over the seats flown. A top-line
 * number wherever routes are shown (WEEK-NINE.md, thread 11), since it
 * says at a glance whether a route's planes are the right size and
 * frequency for its market. Observed on the player's own flights, so it's
 * shown as a number (sim/marketSize.ts keeps the market's hidden size in
 * words).
 *
 * Recorded like on-time performance (sim/routeOtp.ts): each landing adds
 * its passengers and seats to its market's day, and each finished day is
 * copied into a history capped at PNL_HISTORY_MAX_DAYS, per market and for
 * the whole network. The network keeps its own history so a route that has
 * since closed still counts for the days it flew.
 */

/** How many finished days load factor is judged over. */
export const LOAD_WINDOW_DAYS = 7;

export type LoadFactor = {
  passengers: number;
  seats: number;
  /** Passengers over seats, or null when nothing flew in the window. */
  factor: number | null;
};

function pushCapped(history: number[], value: number): void {
  history.push(value);
  if (history.length > PNL_HISTORY_MAX_DAYS) history.shift();
}

/** Called when a flight lands, with what it carried and the seats it had. */
export function recordFlightLoad(state: SimState, key: string, passengers: number, seats: number): void {
  const today = ((state.todayLoadByMarket ??= {})[key] ??= { passengers: 0, seats: 0 });
  today.passengers += passengers;
  today.seats += seats;
}

/**
 * Called once per simulated day from step.ts's rollover, beside the P&L
 * and on-time histories, while `todayLoadByMarket` still holds the
 * finished day. Every market on the schedule gets an entry, even an empty
 * one, so "the last week" always means the last week.
 */
export function recordDailyLoadHistory(state: SimState): void {
  const today = state.todayLoadByMarket ?? {};
  const histories = (state.loadHistoryByMarket ??= {});
  const network = (state.loadHistory ??= { passengers: [], seats: [] });
  let passengers = 0;
  let seats = 0;
  const activeMarkets = new Set(state.schedule.map((leg) => marketKey(leg.origin, leg.dest)));
  for (const key of activeMarkets) {
    const day = today[key] ?? { passengers: 0, seats: 0 };
    const history = (histories[key] ??= { passengers: [], seats: [] });
    pushCapped(history.passengers, day.passengers);
    pushCapped(history.seats, day.seats);
  }
  for (const day of Object.values(today)) {
    passengers += day.passengers;
    seats += day.seats;
  }
  pushCapped(network.passengers, passengers);
  pushCapped(network.seats, seats);
}

function fromHistory(history: { passengers: number[]; seats: number[] } | undefined, days: number): LoadFactor {
  const passengers = (history?.passengers ?? []).slice(-days).reduce((sum, n) => sum + n, 0);
  const seats = (history?.seats ?? []).slice(-days).reduce((sum, n) => sum + n, 0);
  return { passengers, seats, factor: seats > 0 ? passengers / seats : null };
}

/** A market's load factor over its last `days` finished days. */
export function marketLoadFactor(state: SimState, a: string, b: string, days = LOAD_WINDOW_DAYS): LoadFactor {
  return fromHistory(state.loadHistoryByMarket?.[marketKey(a, b)], days);
}

/** The whole airline's load factor over its last `days` finished days. */
export function networkLoadFactor(state: SimState, days = LOAD_WINDOW_DAYS): LoadFactor {
  return fromHistory(state.loadHistory, days);
}

/** A load factor as a percentage for display, or a dash when nothing flew. */
export function formatLoadFactor(load: LoadFactor): string {
  return load.factor === null ? '—' : `${Math.round(load.factor * 100)}%`;
}
